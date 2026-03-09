#!/bin/bash
# Stop Hook: 세션 요약 업데이트
# 응답 완료 시마다 실행 - 현재 세션의 통계 갱신

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

# DB 없으면 스킵
[ ! -f "$DB_PATH" ] && exit 0

SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;" 2>/dev/null)
[ -z "$SESSION_ID" ] && exit 0

# 현재 세션의 편집 파일 수
FILES_CHANGED=$(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID;" 2>/dev/null)
echo "[hook:on-stop] DB 조회: 세션 #$SESSION_ID 편집 파일 수"

# 세션 통계 업데이트
NOW=$(date '+%Y-%m-%d %H:%M:%S')
sqlite3 "$DB_PATH" "UPDATE sessions SET end_time='$NOW', files_changed=$FILES_CHANGED WHERE id=$SESSION_ID;" 2>/dev/null

# session_summary 자동 저장
EDITED_FILES=$(sqlite3 "$DB_PATH" "SELECT DISTINCT file_path FROM tool_usage WHERE session_id=$SESSION_ID ORDER BY id DESC LIMIT 10;" 2>/dev/null)
TOTAL_FILES=$(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID;" 2>/dev/null)

if [ -n "$EDITED_FILES" ] && [ "$TOTAL_FILES" -gt 0 ] 2>/dev/null; then
    FILE_LIST=$(echo "$EDITED_FILES" | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
    if [ "$TOTAL_FILES" -gt 10 ]; then
        EXTRA=$((TOTAL_FILES - 10))
        SUMMARY="${TOTAL_FILES} files: ${FILE_LIST}, ... +${EXTRA} more"
    else
        SUMMARY="${TOTAL_FILES} files: ${FILE_LIST}"
    fi
    bash "$PROJECT_ROOT/.claude/db/helper.sh" live-set session_summary "$SUMMARY"
fi

# Stop stdout은 verbose 모드에서만 보이므로, 피드백을 파일에 축적
FEEDBACK_FILE="$PROJECT_ROOT/.claude/.hook_feedback"
echo "[on-stop] 세션 #$SESSION_ID 통계 갱신 ($FILES_CHANGED files)" >> "$FEEDBACK_FILE"
