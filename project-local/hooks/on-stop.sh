#!/bin/bash
# Stop Hook: 세션 요약 업데이트
# [최적화] 전체 non-blocking — Stop hook은 출력 불필요 (JSON 프로토콜만 지원)

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

[ ! -f "$DB_PATH" ] && exit 0

NOW=$(date '+%Y-%m-%d %H:%M:%S')

# 전체를 백그라운드 서브쉘로 실행 (non-blocking)
(
    SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;" 2>/dev/null)
    [ -z "$SESSION_ID" ] && exit 0

    # duration_minutes 계산
    START_TIME=$(sqlite3 "$DB_PATH" "SELECT start_time FROM sessions WHERE id=$SESSION_ID;" 2>/dev/null)
    DURATION_MIN=""
    if [ -n "$START_TIME" ]; then
        START_EPOCH=$(date -j -f '%Y-%m-%d %H:%M:%S' "$START_TIME" '+%s' 2>/dev/null || date -d "$START_TIME" '+%s' 2>/dev/null)
        NOW_EPOCH=$(date '+%s')
        if [ -n "$START_EPOCH" ] && [ -n "$NOW_EPOCH" ]; then
            DURATION_MIN=$(( (NOW_EPOCH - START_EPOCH) / 60 ))
        fi
    fi

    # 세션 업데이트 + 파일 수/목록 조회를 단일 호출로
    DURATION_SQL=""
    [ -n "$DURATION_MIN" ] && DURATION_SQL=", duration_minutes=$DURATION_MIN"
    QUERY_RESULT=$(sqlite3 -separator '|' "$DB_PATH" "
        UPDATE sessions SET end_time='$NOW', files_changed=(SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID)${DURATION_SQL} WHERE id=$SESSION_ID;
        SELECT
            (SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID),
            (SELECT GROUP_CONCAT(file_path, ', ') FROM (SELECT DISTINCT file_path FROM tool_usage WHERE session_id=$SESSION_ID ORDER BY id DESC LIMIT 10));
    " 2>/dev/null)

    TOTAL_FILES="${QUERY_RESULT%%|*}"
    FILE_LIST="${QUERY_RESULT#*|}"

    if [ -n "$FILE_LIST" ] && [ "$TOTAL_FILES" -gt 0 ] 2>/dev/null; then
        if [ "$TOTAL_FILES" -gt 10 ]; then
            EXTRA=$((TOTAL_FILES - 10))
            SUMMARY="${TOTAL_FILES} files: ${FILE_LIST}, ... +${EXTRA} more"
        else
            SUMMARY="${TOTAL_FILES} files: ${FILE_LIST}"
        fi
        SUMMARY_ESC="${SUMMARY//\'/\'\'}"
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('session_summary', '$SUMMARY_ESC', datetime('now','localtime'));" 2>/dev/null
    fi
) &

exit 0
