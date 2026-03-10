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

    # working_files에 자동 캡처 — helper.sh 대신 직접 sqlite3 인라인
    # live_context 테이블 존재 보장 + 중복 없이 추가 + 최근 20개 제한
    EXISTING=$(sqlite3 "$DB_PATH" "SELECT value FROM live_context WHERE key='working_files';" 2>/dev/null)
    if [ -n "$EXISTING" ]; then
        # 중복 확인
        if echo "$EXISTING" | grep -Fxq "$REL_PATH"; then
            : # 이미 존재, 추가 불필요
        else
            # 추가 후 최근 20개만 유지
            UPDATED=$(printf '%s\n%s' "$EXISTING" "$REL_PATH" | tail -n 20)
            UPDATED_ESC="${UPDATED//\'/\'\'}"
            sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('working_files', '$UPDATED_ESC', datetime('now','localtime'));" 2>/dev/null
        fi
    else
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('working_files', '$REL_PATH', datetime('now','localtime'));" 2>/dev/null
    fi

    # PostToolUse stdout은 verbose 모드에서만 보이므로, 피드백을 파일에 축적
    FEEDBACK_FILE="$PROJECT_ROOT/.claude/.hook_feedback"
    echo "[post-edit] DB 저장: 편집 기록 → $REL_PATH" >> "$FEEDBACK_FILE"
fi
