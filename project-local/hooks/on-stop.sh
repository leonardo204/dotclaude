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
echo "[hook:on-stop] DB 저장: 세션 #$SESSION_ID 통계 갱신 ($FILES_CHANGED files)"
