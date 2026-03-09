#!/bin/bash
# PostToolUse Hook (matcher: Bash): 에러 감지 시 자동 로깅
# stdin으로 tool result JSON 받음

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

[ ! -f "$DB_PATH" ] && exit 0

INPUT=$(cat)

# exit code 추출 (에러인 경우만 처리)
EXIT_CODE=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    # Check for error in output
    stderr = d.get('stderr', '')
    stdout = d.get('stdout', '')
    output = stderr + stdout
    if 'error' in output.lower() or 'failed' in output.lower() or 'fatal' in output.lower():
        # Classify error type
        if 'build' in output.lower() or 'compile' in output.lower():
            print('build_fail')
        elif 'test' in output.lower():
            print('test_fail')
        elif 'conflict' in output.lower():
            print('conflict')
        elif 'permission' in output.lower():
            print('permission')
        else:
            print('runtime_error')
    else:
        print('')
except:
    print('')
" 2>/dev/null)

if [ -n "$EXIT_CODE" ]; then
    SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;" 2>/dev/null)
    sqlite3 "$DB_PATH" "INSERT INTO errors (session_id, tool_name, error_type) VALUES ($SESSION_ID, 'Bash', '$EXIT_CODE');" 2>/dev/null

    # PostToolUse stdout은 verbose 모드에서만 보이므로, 피드백을 파일에 축적
    FEEDBACK_FILE="$PROJECT_ROOT/.claude/.hook_feedback"
    echo "[post-bash] DB 저장: 에러 감지 → $EXIT_CODE" >> "$FEEDBACK_FILE"
fi
