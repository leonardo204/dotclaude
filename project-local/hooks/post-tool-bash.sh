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

    # error_context에 자동 캡처 (최근 1건 덮어쓰기)
    # stdin에서 file_path 추출 시도
    ERR_FILE=$(echo "$INPUT" | python3 -c "
import sys, json, re
try:
    d = json.load(sys.stdin)
    cmd = d.get('tool_input',{}).get('command','')
    # 파일 경로 추출 시도 (마지막 인자 또는 에러 출력에서)
    stderr = d.get('stderr','')
    stdout = d.get('stdout','')
    output = stderr + stdout
    # 일반적인 파일 경로 패턴 매칭
    m = re.search(r'(?:^|[\s:])([^\s:]+\.\w{1,10})(?:[\s:]|$)', output)
    if m:
        print(m.group(1))
    else:
        print('')
except:
    print('')
" 2>/dev/null)
    ERR_INFO="${EXIT_CODE}: ${ERR_FILE:-unknown}"
    bash "$PROJECT_ROOT/.claude/db/helper.sh" live-set error_context "$ERR_INFO"

    # PostToolUse stdout은 verbose 모드에서만 보이므로, 피드백을 파일에 축적
    FEEDBACK_FILE="$PROJECT_ROOT/.claude/.hook_feedback"
    echo "[post-bash] DB 저장: 에러 감지 → $EXIT_CODE" >> "$FEEDBACK_FILE"
fi
