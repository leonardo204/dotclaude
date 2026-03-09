#!/bin/bash
# Stop Hook (Ralph): 작업 미완료 시 중단 차단
# Ralph 모드가 활성화되어 있고 완료되지 않았으면 계속 진행하도록 메시지 주입

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RALPH_STATE="$PROJECT_ROOT/.claude/.ralph_state"

# Ralph 상태 파일 확인
if [ ! -f "$RALPH_STATE" ]; then
    exit 0
fi

# 상태 파싱
ACTIVE=$(python3 -c "
import json, sys
try:
    with open('$RALPH_STATE') as f:
        d = json.load(f)
    if d.get('active') and d.get('status') != 'completed':
        print('YES')
        print(d.get('iteration', 0))
        print(d.get('goal', ''))
    else:
        print('NO')
except:
    print('NO')
" 2>/dev/null)

IS_ACTIVE=$(echo "$ACTIVE" | head -1)
ITERATION=$(echo "$ACTIVE" | sed -n '2p')
GOAL=$(echo "$ACTIVE" | sed -n '3p')

if [ "$IS_ACTIVE" = "YES" ]; then
    echo "[hook:ralph] ⚠️ Ralph 모드 활성 (반복 #$ITERATION) — 작업 미완료"
    echo "[hook:ralph] 목표: $GOAL"
    echo "[hook:ralph] 중단하지 마세요. 계속 작업하세요."
    echo "[hook:ralph] 빌드/테스트를 실행하고, 실패하면 수정하고, 완료될 때까지 반복하세요."
    echo "[hook:ralph] 완료하려면 모든 검증을 통과한 후 .ralph_state의 status를 'completed'로 변경하세요."
    echo "[hook:ralph] 강제 중단: bash -c 'echo {\"active\":false,\"status\":\"cancelled\"} > $RALPH_STATE'"
fi
