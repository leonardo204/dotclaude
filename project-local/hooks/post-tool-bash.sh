#!/bin/bash
# PostToolUse Hook (matcher: Bash): 에러 감지 시 자동 로깅
# [최적화] jq 제거 → bash 문자열 매칭, sqlite3 백그라운드 실행

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

[ ! -f "$DB_PATH" ] && exit 0

INPUT=$(cat)

# 빠른 에러 감지: 대소문자 무관 패턴 매칭 (shopt -s nocasematch 사용 — bash 3.2 호환)
shopt -s nocasematch
if [[ "$INPUT" != *error* && "$INPUT" != *failed* && "$INPUT" != *fatal* ]]; then
    shopt -u nocasematch
    exit 0
fi

# 에러 분류
if [[ "$INPUT" == *build* || "$INPUT" == *compile* ]]; then
    ERR_TYPE="build_fail"
elif [[ "$INPUT" == *test* ]]; then
    ERR_TYPE="test_fail"
elif [[ "$INPUT" == *conflict* ]]; then
    ERR_TYPE="conflict"
elif [[ "$INPUT" == *permission* ]]; then
    ERR_TYPE="permission"
else
    ERR_TYPE="runtime_error"
fi
shopt -u nocasematch

# 파일 경로 추출 시도 (간단한 패턴)
ERR_FILE=""
if [[ "$INPUT" =~ [^[:space:]:]+\.[a-zA-Z]{1,10} ]]; then
    ERR_FILE="${BASH_REMATCH[0]}"
fi

ERR_INFO="${ERR_TYPE}: ${ERR_FILE:-unknown}"
ERR_INFO_ESC="${ERR_INFO//\'/\'\'}"

# sqlite3 호출을 백그라운드로 (에러 INSERT + live_context 업데이트를 단일 호출)
sqlite3 "$DB_PATH" "
    INSERT INTO errors (session_id, error_type, file_path)
    VALUES ((SELECT id FROM sessions ORDER BY id DESC LIMIT 1), 'Bash', '${ERR_TYPE}');
    INSERT OR REPLACE INTO live_context (key, value, updated_at)
    VALUES ('error_context', '$ERR_INFO_ESC', datetime('now','localtime'));
" 2>/dev/null &

exit 0
