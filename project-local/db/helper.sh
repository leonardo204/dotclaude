#!/bin/bash
# SQLite DB Helper - 에이전트/Hook에서 공통 사용
# Usage: bash .claude/db/helper.sh <command> [args...]

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"
INIT_SQL="$PROJECT_ROOT/.claude/db/init.sql"

# DB 없으면 초기화
[ ! -f "$DB_PATH" ] && sqlite3 "$DB_PATH" < "$INIT_SQL"

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

    # === 컨텍스트 ===
    ctx-get)
        # helper.sh ctx-get <key>
        sqlite3 "$DB_PATH" "SELECT value FROM context WHERE key='$1' ORDER BY updated_at DESC LIMIT 1;"
        ;;
    ctx-set)
        # helper.sh ctx-set <key> <value> <category>
        sqlite3 "$DB_PATH" "INSERT INTO context (key, value, category) VALUES ('$1', '$2', '${3:-general}');"
        ;;
    ctx-search)
        # helper.sh ctx-search <keyword>
        sqlite3 -header -column "$DB_PATH" "SELECT key, value, category, updated_at FROM context WHERE key LIKE '%$1%' OR value LIKE '%$1%' ORDER BY updated_at DESC LIMIT 10;"
        ;;
    ctx-list)
        # helper.sh ctx-list [category]
        if [ -n "$1" ]; then
            sqlite3 -header -column "$DB_PATH" "SELECT key, substr(value,1,80) as value, updated_at FROM context WHERE category='$1' ORDER BY updated_at DESC;"
        else
            sqlite3 -header -column "$DB_PATH" "SELECT category, COUNT(*) as count FROM context GROUP BY category ORDER BY count DESC;"
        fi
        ;;

    # === 태스크 ===
    task-add)
        # helper.sh task-add <description> [priority] [category]
        sqlite3 "$DB_PATH" "INSERT INTO tasks (description, priority, category) VALUES ('$1', ${2:-3}, '${3:-}');"
        echo "Task added."
        ;;
    task-list)
        # helper.sh task-list [status]
        STATUS="${1:-pending}"
        if [ "$STATUS" = "all" ]; then
            sqlite3 -header -column "$DB_PATH" "SELECT id, status, priority, description, category FROM tasks ORDER BY priority, created_at;"
        else
            sqlite3 -header -column "$DB_PATH" "SELECT id, priority, description, category FROM tasks WHERE status='$STATUS' ORDER BY priority, created_at;"
        fi
        ;;
    task-done)
        # helper.sh task-done <id>
        sqlite3 "$DB_PATH" "UPDATE tasks SET status='done', completed_at=datetime('now','localtime') WHERE id=$1;"
        echo "Task #$1 marked done."
        ;;
    task-update)
        # helper.sh task-update <id> <status>
        sqlite3 "$DB_PATH" "UPDATE tasks SET status='$2' WHERE id=$1;"
        echo "Task #$1 → $2"
        ;;

    # === 결정 ===
    decision-add)
        # helper.sh decision-add <description> <reason> [files_json]
        sqlite3 "$DB_PATH" "INSERT INTO decisions (description, reason, related_files) VALUES ('$1', '$2', '${3:-}');"
        echo "Decision recorded."
        ;;
    decision-list)
        sqlite3 -header -column "$DB_PATH" "SELECT id, date, description, status FROM decisions ORDER BY id DESC LIMIT ${1:-10};"
        ;;

    # === 에러 ===
    error-log)
        # helper.sh error-log <error_type> <file_path> [resolution]
        SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;")
        sqlite3 "$DB_PATH" "INSERT INTO errors (session_id, error_type, file_path, resolution) VALUES ($SESSION_ID, '$1', '$2', '${3:-}');"
        ;;
    error-list)
        sqlite3 -header -column "$DB_PATH" "SELECT error_type, file_path, resolution, timestamp FROM errors ORDER BY id DESC LIMIT ${1:-10};"
        ;;

    # === 커밋 ===
    commit-log)
        # helper.sh commit-log <hash> <message> [files_json]
        SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;")
        sqlite3 "$DB_PATH" "INSERT INTO commits (session_id, hash, message, files_changed) VALUES ($SESSION_ID, '$1', '$2', '${3:-}');"
        ;;

    # === Live Context (compaction-safe) ===
    live-set)
        # helper.sh live-set <key> <value>
        KEY="${1//\'/\'\'}"
        VALUE="${2//\'/\'\'}"
        sqlite3 "$DB_PATH" "CREATE TABLE IF NOT EXISTS live_context (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));"
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('$KEY', '$VALUE', datetime('now','localtime'));"
        ;;
    live-get)
        # helper.sh live-get [key]
        if [ -n "$1" ]; then
            sqlite3 "$DB_PATH" "SELECT value FROM live_context WHERE key='$1';" 2>/dev/null
        else
            sqlite3 "$DB_PATH" "SELECT key || ': ' || value FROM live_context ORDER BY key;" 2>/dev/null
        fi
        ;;
    live-dump)
        # helper.sh live-dump (formatted for context injection)
        sqlite3 "$DB_PATH" "SELECT '- ' || key || ': ' || value FROM live_context ORDER BY key;" 2>/dev/null
        ;;
    live-clear)
        sqlite3 "$DB_PATH" "DELETE FROM live_context;" 2>/dev/null
        echo "Live context cleared."
        ;;

    # === 도구 사용 ===
    tool-log)
        # helper.sh tool-log <tool_name> <file_path>
        SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;")
        sqlite3 "$DB_PATH" "INSERT INTO tool_usage (session_id, tool_name, file_path) VALUES ($SESSION_ID, '$1', '$2');" 2>/dev/null
        ;;

    # === 통계 ===
    stats)
        echo "=== DB Stats ==="
        echo "Sessions: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM sessions;')"
        echo "Context entries: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM context;')"
        echo "Tasks (pending): $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tasks WHERE status='pending';")"
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
        echo "  ctx-get <key>           Get context value"
        echo "  ctx-set <key> <val> [cat] Set context"
        echo "  ctx-search <keyword>    Search context"
        echo "  ctx-list [category]     List context"
        echo "  task-add <desc> [pri] [cat] Add task"
        echo "  task-list [status|all]  List tasks"
        echo "  task-done <id>          Complete task"
        echo "  task-update <id> <st>   Update task status"
        echo "  decision-add <desc> <reason> Record decision"
        echo "  decision-list [n]       List decisions"
        echo "  error-log <type> <file> Log error"
        echo "  error-list [n]          List errors"
        echo "  commit-log <hash> <msg> Log commit"
        echo "  tool-log <tool> <file>  Log tool usage"
        echo "  live-set <key> <val>    Set live context (compaction-safe)"
        echo "  live-get [key]          Get live context"
        echo "  live-dump               Dump all live context"
        echo "  live-clear              Clear live context"
        echo "  stats                   Show DB statistics"
        echo "  query <sql>             Run raw SQL"
        ;;
esac
