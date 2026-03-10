#!/bin/bash
# PostToolUse Hook (matcher: Edit): 파일 편집 로그
# stdin으로 tool_input JSON을 받음
# [최적화] python3 → jq, helper.sh live-append → 직접 sqlite3 인라인

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

# DB 없으면 스킵
[ ! -f "$DB_PATH" ] && exit 0

# stdin에서 JSON 읽기
INPUT=$(cat)

# file_path 추출 — jq 우선, fallback은 grep/sed
if command -v jq >/dev/null 2>&1; then
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
    # 순수 bash fallback: "file_path":"..." 패턴 매칭
    FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | sed 's/"file_path":"//;s/"$//')
fi

if [ -n "$FILE_PATH" ]; then
    # 프로젝트 상대 경로로 변환
    REL_PATH="${FILE_PATH#$PROJECT_ROOT/}"

    # 현재 세션 ID + tool_usage INSERT를 단일 sqlite3 호출로 병합
    sqlite3 "$DB_PATH" "
        INSERT INTO tool_usage (session_id, tool_name, file_path)
        VALUES ((SELECT id FROM sessions ORDER BY id DESC LIMIT 1), 'Edit', '$REL_PATH');
    " 2>/dev/null
fi
