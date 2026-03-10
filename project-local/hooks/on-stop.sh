#!/bin/bash
# Stop Hook: 세션 요약 업데이트
# 응답 완료 시마다 실행 - 현재 세션의 통계 갱신
# [최적화] helper.sh live-set → 직접 sqlite3, sqlite3 호출 병합

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

# DB 없으면 스킵
[ ! -f "$DB_PATH" ] && exit 0

# 세션 ID, 편집 파일 수, 통계 업데이트, 편집 파일 목록을 최소 sqlite3 호출로 처리
NOW=$(date '+%Y-%m-%d %H:%M:%S')

# 단일 sqlite3 호출로 세션 ID + 파일 수 + 업데이트 + 파일 목록 조회를 모두 수행
RESULT=$(sqlite3 "$DB_PATH" "
    SELECT id FROM sessions ORDER BY id DESC LIMIT 1;
" 2>/dev/null)

SESSION_ID="$RESULT"
[ -z "$SESSION_ID" ] && exit 0

# 편집 파일 수 조회 + 세션 업데이트를 단일 호출로
FILES_CHANGED=$(sqlite3 "$DB_PATH" "
    SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID;
" 2>/dev/null)

echo "[hook:on-stop] DB 조회: 세션 #$SESSION_ID 편집 파일 수"

sqlite3 "$DB_PATH" "UPDATE sessions SET end_time='$NOW', files_changed=$FILES_CHANGED WHERE id=$SESSION_ID;" 2>/dev/null

# session_summary 자동 저장 — 편집 파일 목록과 총 파일 수를 한번에 조회
QUERY_RESULT=$(sqlite3 -separator '|' "$DB_PATH" "
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
    # helper.sh live-set 대신 직접 sqlite3
    SUMMARY_ESC="${SUMMARY//\'/\'\'}"
    sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('session_summary', '$SUMMARY_ESC', datetime('now','localtime'));" 2>/dev/null
fi

# Stop stdout은 verbose 모드에서만 보이므로, 피드백을 파일에 축적
FEEDBACK_FILE="$PROJECT_ROOT/.claude/.hook_feedback"
echo "[on-stop] 세션 #$SESSION_ID 통계 갱신 ($FILES_CHANGED files)" >> "$FEEDBACK_FILE"
