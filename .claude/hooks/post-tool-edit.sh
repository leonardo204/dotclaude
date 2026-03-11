#!/bin/bash
# PostToolUse Hook (matcher: Edit|Write): 파일 편집 로그
# [최적화] jq 제거 → bash 문자열 매칭, sqlite3 백그라운드 실행

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

[ ! -f "$DB_PATH" ] && exit 0

# stdin에서 file_path 추출 — 순수 bash (jq/grep 없음)
INPUT=$(cat)
# "file_path":"/some/path" 패턴 매칭
FILE_PATH="${INPUT#*\"file_path\":\"}"
FILE_PATH="${FILE_PATH%%\"*}"

# 유효한 경로인지 간단 체크 (/ 로 시작)
[[ "$FILE_PATH" != /* ]] && exit 0

# 프로젝트 상대 경로로 변환
REL_PATH="${FILE_PATH#$PROJECT_ROOT/}"

# sqlite3 INSERT를 백그라운드로 실행 (fire-and-forget)
sqlite3 "$DB_PATH" "
    INSERT INTO tool_usage (session_id, tool_name, file_path)
    VALUES ((SELECT id FROM sessions ORDER BY id DESC LIMIT 1), 'Edit', '${REL_PATH//\'/\'\'}');
" 2>/dev/null &

exit 0
