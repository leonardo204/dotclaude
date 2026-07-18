#!/bin/bash
# SQLite DB Helper - 에이전트/Hook에서 공통 사용
# Usage: bash .claude/db/helper.sh <command> [args...]

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"
INIT_SQL="$PROJECT_ROOT/.claude/db/init.sql"

# DB 없으면 초기화
[ ! -f "$DB_PATH" ] && sqlite3 "$DB_PATH" < "$INIT_SQL"

# 멱등 마이그레이션 (schema 1.2 → 1.3): 죽은 테이블 제거.
# tasks/context 는 네이티브 대체(TodoWrite/auto-memory)로 write 경로가 죽었고,
# prompts/context_fts 는 삽입 경로가 없어 항상 비어 있다.
# 데이터 보호: tasks/context 는 0행일 때만 DROP(만약의 사용자 데이터 보존).
#   prompts/context_fts(+동기화 트리거)는 무조건 DROP IF EXISTS.
# schema_version=1.3 을 완료 플래그로 사용해 1회만 수행(멱등).
_schema=$(sqlite3 "$DB_PATH" "SELECT value FROM db_meta WHERE key='schema_version';" 2>/dev/null)
if [ "$_schema" != "1.3" ]; then
    # context_fts 동기화 트리거 + 가상테이블 (삽입 경로 없음 — 항상 빔).
    # context 테이블보다 먼저 제거해야 content-table 링크 오류가 없다.
    sqlite3 "$DB_PATH" "DROP TRIGGER IF EXISTS context_fts_ai;" 2>/dev/null
    sqlite3 "$DB_PATH" "DROP TRIGGER IF EXISTS context_fts_ad;" 2>/dev/null
    sqlite3 "$DB_PATH" "DROP TRIGGER IF EXISTS context_fts_au;" 2>/dev/null
    sqlite3 "$DB_PATH" "DROP TABLE IF EXISTS context_fts;" 2>/dev/null
    # prompts (유령 — 삽입 코드 0)
    sqlite3 "$DB_PATH" "DROP TABLE IF EXISTS prompts;" 2>/dev/null
    # tasks / context 는 0행 가드 후에만 DROP (데이터 손실 방지)
    _tasks_n=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tasks;" 2>/dev/null)
    [ "$_tasks_n" = "0" ] && sqlite3 "$DB_PATH" "DROP TABLE IF EXISTS tasks;" 2>/dev/null
    _context_n=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM context;" 2>/dev/null)
    [ "$_context_n" = "0" ] && sqlite3 "$DB_PATH" "DROP TABLE IF EXISTS context;" 2>/dev/null
    # schema_version 갱신 (db_meta 는 init.sql 로 항상 존재)
    sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO db_meta (key, value) VALUES ('schema_version', '1.3');" 2>/dev/null
fi

# SQL 문자열 리터럴 이스케이프: ' → ''
#
# 주의: "${1//\'/\'\'}" 를 쓰면 안 된다. 큰따옴표 안에서 백슬래시는 ' 를 이스케이프하지
# 않으므로 치환 결과에 백슬래시가 그대로 남아 \'\' 가 되고, SQLite 가
# "unrecognized token: \" 로 거부한다. 값이 조용히 유실된다.
_esc() { printf '%s' "${1:-}" | sed "s/'/''/g"; }

CMD="$1"
shift

case "$CMD" in
    # === 세션 ===
    session-current)
        sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;"
        ;;
    session-info)
        sqlite3 -header -column "$DB_PATH" "SELECT * FROM sessions ORDER BY id DESC LIMIT ${1:-5};"
        ;;

    # === 결정 ===
    decision-add)
        # helper.sh decision-add <description> <reason> [files_json]
        sqlite3 "$DB_PATH" "INSERT INTO decisions (description, reason, related_files) VALUES ('$(_esc "$1")', '$(_esc "$2")', '$(_esc "${3:-}")');"
        echo "Decision recorded."
        ;;
    decision-list)
        sqlite3 -header -column "$DB_PATH" "SELECT id, date, description, status FROM decisions ORDER BY id DESC LIMIT ${1:-10};"
        ;;

    # === 에러 ===
    error-log)
        # helper.sh error-log <error_type> <file_path> [resolution]
        SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;")
        sqlite3 "$DB_PATH" "INSERT INTO errors (session_id, error_type, file_path, resolution) VALUES ($SESSION_ID, '$(_esc "$1")', '$(_esc "$2")', '$(_esc "${3:-}")');"
        ;;
    error-list)
        sqlite3 -header -column "$DB_PATH" "SELECT error_type, file_path, resolution, timestamp FROM errors ORDER BY id DESC LIMIT ${1:-10};"
        ;;

    # === 커밋 ===
    commit-log)
        # helper.sh commit-log <hash> <message> [files_json]
        SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;")
        sqlite3 "$DB_PATH" "INSERT INTO commits (session_id, hash, message, files_changed) VALUES ($SESSION_ID, '$(_esc "$1")', '$(_esc "$2")', '$(_esc "${3:-}")');"
        ;;

    # === Live Context (compaction-safe) ===
    live-set)
        # helper.sh live-set <key> <value>
        KEY="$(_esc "$1")"
        VALUE="$(_esc "$2")"
        sqlite3 "$DB_PATH" "CREATE TABLE IF NOT EXISTS live_context (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));"
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('$KEY', '$VALUE', datetime('now','localtime'));"
        ;;
    live-get)
        # helper.sh live-get [key]
        if [ -n "$1" ]; then
            sqlite3 "$DB_PATH" "SELECT value FROM live_context WHERE key='$(_esc "$1")';" 2>/dev/null
        else
            sqlite3 "$DB_PATH" "SELECT key || ': ' || value FROM live_context ORDER BY key;" 2>/dev/null
        fi
        ;;
    live-dump)
        # helper.sh live-dump (formatted for context injection)
        sqlite3 "$DB_PATH" "SELECT '- ' || key || ': ' || value FROM live_context ORDER BY key;" 2>/dev/null
        ;;

    # === Agent 핸드오프 ===
    agent-task)
        NAME="$1"
        if [ -n "$2" ]; then
            VALUE="$2"
            VALUE_ESC="$(_esc "$VALUE")"
            sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('_task:$NAME', '$VALUE_ESC', datetime('now','localtime'));"
        elif [ ! -t 0 ]; then
            VALUE=$(cat)
            VALUE_ESC="$(_esc "$VALUE")"
            sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('_task:$NAME', '$VALUE_ESC', datetime('now','localtime'));"
        else
            sqlite3 "$DB_PATH" "SELECT value FROM live_context WHERE key='_task:$NAME';" 2>/dev/null
        fi
        ;;

    agent-result)
        NAME="$1"
        if [ -n "$2" ]; then
            VALUE="$2"
            VALUE_ESC="$(_esc "$VALUE")"
            sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('_result:$NAME', '$VALUE_ESC', datetime('now','localtime'));"
        elif [ ! -t 0 ]; then
            VALUE=$(cat)
            VALUE_ESC="$(_esc "$VALUE")"
            sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('_result:$NAME', '$VALUE_ESC', datetime('now','localtime'));"
        else
            sqlite3 "$DB_PATH" "SELECT value FROM live_context WHERE key='_result:$NAME';" 2>/dev/null
        fi
        ;;

    agent-context)
        KEY="$1"
        if [ -n "$2" ]; then
            VALUE="$2"
            VALUE_ESC="$(_esc "$VALUE")"
            sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('_ctx:$KEY', '$VALUE_ESC', datetime('now','localtime'));"
        elif [ ! -t 0 ]; then
            VALUE=$(cat)
            VALUE_ESC="$(_esc "$VALUE")"
            sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('_ctx:$KEY', '$VALUE_ESC', datetime('now','localtime'));"
        else
            sqlite3 "$DB_PATH" "SELECT value FROM live_context WHERE key='_ctx:$KEY';" 2>/dev/null
        fi
        ;;

    # === 도구 사용 ===
    tool-log)
        # helper.sh tool-log <tool_name> <file_path>
        SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;")
        sqlite3 "$DB_PATH" "INSERT INTO tool_usage (session_id, tool_name, file_path) VALUES ($SESSION_ID, '$(_esc "$1")', '$(_esc "$2")');" 2>/dev/null
        ;;

    # === 통계 ===
    stats)
        echo "=== DB Stats ==="
        echo "Sessions: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM sessions;')"
        echo "Decisions: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM decisions;')"
        echo "Tool usages: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM tool_usage;')"
        echo "Commits: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM commits;')"
        echo "Errors: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM errors;')"
        echo "Live context: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM live_context;' 2>/dev/null || echo 0)"
        ;;

    # === Raw SQL ===
    query)
        # helper.sh query "SELECT ..."
        sqlite3 -header -column "$DB_PATH" "$1"
        ;;

    *)
        echo "Usage: helper.sh <command> [args...]"
        echo ""
        echo "Commands:"
        echo "  session-current         Current session ID"
        echo "  session-info [n]        Last N sessions"
        echo "  decision-add <desc> <reason> Record decision"
        echo "  decision-list [n]       List decisions"
        echo "  error-log <type> <file> Log error"
        echo "  error-list [n]          List errors"
        echo "  commit-log <hash> <msg> Log commit"
        echo "  tool-log <tool> <file>  Log tool usage"
        echo "  live-set <key> <val>    Set live context (compaction-safe)"
        echo "  live-get [key]          Get live context"
        echo "  live-dump               Dump all live context"
        echo "  stats                   Show DB statistics"
        echo "  query <sql>             Run raw SQL"
        echo ""
        echo "  Agent:"
        echo "    agent-task <name> [content]     에이전트 태스크 설정/조회 (stdin 지원)"
        echo "    agent-result <name> [content]   에이전트 결과 설정/조회 (stdin 지원)"
        echo "    agent-context <key> [value]     공유 컨텍스트 설정/조회 (stdin 지원)"
        ;;
esac
