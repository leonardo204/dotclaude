#!/bin/bash
# PostToolUse Hook (matcher: Bash): 에러 감지 시 자동 로깅
# stdin으로 tool result JSON 받음
# [최적화] python3 2회 → jq 1회 (에러 분류 + 파일 경로 추출을 단일 jq 호출로 통합)

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

[ ! -f "$DB_PATH" ] && exit 0

INPUT=$(cat)

# 에러 분류 + 파일 경로 추출을 한번에 수행
if command -v jq >/dev/null 2>&1; then
    # jq로 단일 호출: "error_type|file_path" 형식 반환
    RESULT=$(echo "$INPUT" | jq -r '
        def classify:
            ((.stderr // "") + (.stdout // "")) as $output |
            ($output | ascii_downcase) as $lower |
            if ($lower | test("error|failed|fatal")) then
                if ($lower | test("build|compile")) then "build_fail"
                elif ($lower | test("test")) then "test_fail"
                elif ($lower | test("conflict")) then "conflict"
                elif ($lower | test("permission")) then "permission"
                else "runtime_error"
                end
            else ""
            end;
        def extract_file:
            ((.stderr // "") + (.stdout // "")) as $output |
            ($output | capture("(?:^|[\\s:])(?<f>[^\\s:]+\\.[a-zA-Z]{1,10})(?:[\\s:]|$)") // {f:""}) | .f;
        classify as $err |
        if $err == "" then ""
        else ($err + "|" + extract_file)
        end
    ' 2>/dev/null)
else
    # 순수 bash fallback
    STDERR=$(echo "$INPUT" | grep -o '"stderr":"[^"]*"' | head -1 | sed 's/"stderr":"//;s/"$//')
    STDOUT=$(echo "$INPUT" | grep -o '"stdout":"[^"]*"' | head -1 | sed 's/"stdout":"//;s/"$//')
    OUTPUT="$STDERR$STDOUT"
    OUTPUT_LOWER=$(echo "$OUTPUT" | tr '[:upper:]' '[:lower:]')

    ERR_TYPE=""
    if echo "$OUTPUT_LOWER" | grep -qE 'error|failed|fatal'; then
        if echo "$OUTPUT_LOWER" | grep -qE 'build|compile'; then
            ERR_TYPE="build_fail"
        elif echo "$OUTPUT_LOWER" | grep -q 'test'; then
            ERR_TYPE="test_fail"
        elif echo "$OUTPUT_LOWER" | grep -q 'conflict'; then
            ERR_TYPE="conflict"
        elif echo "$OUTPUT_LOWER" | grep -q 'permission'; then
            ERR_TYPE="permission"
        else
            ERR_TYPE="runtime_error"
        fi
    fi

    if [ -n "$ERR_TYPE" ]; then
        # 파일 경로 추출 시도
        ERR_FILE=$(echo "$OUTPUT" | grep -oE '[^ :]+\.[a-zA-Z]{1,10}' | head -1)
        RESULT="${ERR_TYPE}|${ERR_FILE}"
    else
        RESULT=""
    fi
fi

if [ -n "$RESULT" ]; then
    EXIT_CODE="${RESULT%%|*}"
    ERR_FILE="${RESULT#*|}"

    # 세션 ID 조회 + 에러 INSERT를 단일 sqlite3 호출로 병합
    sqlite3 "$DB_PATH" "
        INSERT INTO errors (session_id, tool_name, error_type)
        VALUES ((SELECT id FROM sessions ORDER BY id DESC LIMIT 1), 'Bash', '$EXIT_CODE');
    " 2>/dev/null

    # error_context에 자동 캡처 — helper.sh 대신 직접 sqlite3 인라인
    ERR_INFO="${EXIT_CODE}: ${ERR_FILE:-unknown}"
    ERR_INFO_ESC="${ERR_INFO//\'/\'\'}"
    sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('error_context', '$ERR_INFO_ESC', datetime('now','localtime'));" 2>/dev/null

fi
