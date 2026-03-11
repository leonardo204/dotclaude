#!/bin/bash
# SessionStart Hook: 자동 checkin
# - DB 초기화 확인
# - 세션 기록
# - 마지막 세션과의 간격에 따라 브리핑 수준 결정

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"
INIT_SQL="$PROJECT_ROOT/.claude/db/init.sql"

# DB 초기화 (없으면 생성)
if [ ! -f "$DB_PATH" ]; then
    sqlite3 "$DB_PATH" < "$INIT_SQL"
    echo "[hook:session-start] DB 초기화 완료"
fi

# 현재 시간
NOW=$(date '+%Y-%m-%d %H:%M:%S')
TODAY=$(date '+%Y-%m-%d')
WEEKDAY=$(date '+%A')

# 마지막 세션 조회
LAST_SESSION=$(sqlite3 "$DB_PATH" "SELECT start_time FROM sessions ORDER BY id DESC LIMIT 1;" 2>/dev/null)

# 새 세션 생성 + 세션 스코프 live_context 초기화 (단일 호출)
SESSION_ID=$(sqlite3 "$DB_PATH" "
    INSERT INTO sessions (start_time) VALUES ('$NOW');
    SELECT last_insert_rowid();
    DELETE FROM live_context WHERE key IN ('working_files', 'error_context') OR key LIKE '_result:%' OR key LIKE '_task:%';
")

# CLAUDE.md 지침 DB 캐시 — compaction 후 자동 복구용
# 글로벌: ~/.claude/CLAUDE.md → _rules
GLOBAL_MD="$HOME/.claude/CLAUDE.md"
if [ -f "$GLOBAL_MD" ]; then
    GLOBAL_RULES=$(sed -n '/^## /,/^---$/p' "$GLOBAL_MD" | grep -E '^- \*\*|^\*\*|^### ' | head -20)
    if [ -n "$GLOBAL_RULES" ]; then
        GLOBAL_ESC="${GLOBAL_RULES//\'/\'\'}"
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('_rules', '$GLOBAL_ESC', datetime('now','localtime'));" 2>/dev/null
    fi
fi

# 프로젝트: CLAUDE.md → _project_rules
if [ -f "$PROJECT_ROOT/CLAUDE.md" ]; then
    PROJ=$(sed -n '/^## PROJECT/,/^---$/p' "$PROJECT_ROOT/CLAUDE.md" | head -30)
    if [ -n "$PROJ" ]; then
        PROJ_ESC="${PROJ//\'/\'\'}"
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('_project_rules', '$PROJ_ESC', datetime('now','localtime'));" 2>/dev/null
    fi
fi

# 간격 계산
if [ -n "$LAST_SESSION" ]; then
    LAST_TS=$(date -j -f '%Y-%m-%d %H:%M:%S' "$LAST_SESSION" '+%s' 2>/dev/null)
    NOW_TS=$(date '+%s')
    if [ -n "$LAST_TS" ]; then
        DIFF_HOURS=$(( (NOW_TS - LAST_TS) / 3600 ))
    else
        DIFF_HOURS=0
    fi
else
    DIFF_HOURS=9999
fi

# 결과 출력 (Claude에게 전달)
echo "[checkin] Session #$SESSION_ID started: $NOW ($WEEKDAY)"

if [ "$DIFF_HOURS" -ge 24 ]; then
    echo "[checkin] Last session: $LAST_SESSION (${DIFF_HOURS}h ago - LONG BREAK)"
    echo "[checkin] Action needed: full briefing recommended"

    # 미완료 태스크
    PENDING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tasks WHERE status IN ('pending','in_progress');" 2>/dev/null)
    if [ "$PENDING" -gt 0 ] 2>/dev/null; then
        echo "[checkin] Pending tasks: $PENDING"
        sqlite3 "$DB_PATH" "SELECT '  - [' || status || '] ' || description FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority LIMIT 5;"
    fi
elif [ "$DIFF_HOURS" -ge 4 ]; then
    echo "[checkin] Last session: $LAST_SESSION (${DIFF_HOURS}h ago - moderate break)"
    echo "[checkin] Quick sync recommended"
else
    echo "[checkin] Last session: $LAST_SESSION (${DIFF_HOURS}h ago - recent)"
fi

# 커스텀 명령어 안내 (세션 시작 시 사용자에게 표시)
# .claude/commands/*.md 파일에서 동적으로 읽어옴 (첫 줄 = 설명)
COMMANDS_DIR="$PROJECT_ROOT/.claude/commands"
echo ""
echo "[project] Available commands:"
if [ -d "$COMMANDS_DIR" ]; then
    for cmd_file in "$COMMANDS_DIR"/*.md; do
        [ -f "$cmd_file" ] || continue
        cmd_name=$(basename "$cmd_file" .md)
        cmd_desc=$(head -1 "$cmd_file")
        printf "  /project:%-10s - %s\n" "$cmd_name" "$cmd_desc"
    done
fi
