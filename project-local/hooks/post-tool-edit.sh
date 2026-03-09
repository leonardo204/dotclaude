#!/bin/bash
# PostToolUse Hook (matcher: Edit): 파일 편집 로그
# stdin으로 tool_input JSON을 받음

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

# DB 없으면 스킵
[ ! -f "$DB_PATH" ] && exit 0

# stdin에서 JSON 읽기
INPUT=$(cat)

# file_path 추출
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null)

if [ -n "$FILE_PATH" ]; then
    # 현재 세션 ID
    SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;" 2>/dev/null)

    # 프로젝트 상대 경로로 변환
    REL_PATH="${FILE_PATH#$PROJECT_ROOT/}"

    # 로깅
    sqlite3 "$DB_PATH" "INSERT INTO tool_usage (session_id, tool_name, file_path) VALUES ($SESSION_ID, 'Edit', '$REL_PATH');" 2>/dev/null

    # PostToolUse stdout은 verbose 모드에서만 보이므로, 피드백을 파일에 축적
    FEEDBACK_FILE="$PROJECT_ROOT/.claude/.hook_feedback"
    echo "[post-edit] DB 저장: 편집 기록 → $REL_PATH" >> "$FEEDBACK_FILE"
fi
