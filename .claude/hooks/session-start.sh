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
echo "[hook:session-start] DB 조회: 마지막 세션 정보"

# 새 세션 생성
SESSION_ID=$(sqlite3 "$DB_PATH" "INSERT INTO sessions (start_time) VALUES ('$NOW'); SELECT last_insert_rowid();")
echo "[hook:session-start] DB 저장: 세션 #$SESSION_ID 생성"

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
    echo "[checkin] Action needed: git fetch + full briefing recommended"
    echo "[checkin] Run: git fetch origin && git log --oneline HEAD..origin/main"

    # remote 변경 확인
    cd "$PROJECT_ROOT"
    git fetch origin 2>/dev/null
    BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null)
    AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null)
    if [ "$BEHIND" -gt 0 ] 2>/dev/null; then
        echo "[checkin] WARNING: $BEHIND commits behind remote. Consider git pull."
    fi
    if [ "$AHEAD" -gt 0 ] 2>/dev/null; then
        echo "[checkin] $AHEAD commits ahead of remote (not pushed)."
    fi

    # 미완료 태스크
    PENDING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tasks WHERE status IN ('pending','in_progress');" 2>/dev/null)
    echo "[hook:session-start] DB 조회: 미완료 태스크"
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

# 총 세션 수
TOTAL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sessions;" 2>/dev/null)
echo "[hook:session-start] DB 조회: 총 세션 수"
echo "[checkin] Total sessions: $TOTAL"

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
echo "[project] IMPORTANT: 세션 시작 시 위 정보를 사용자에게 반드시 보여주세요."
