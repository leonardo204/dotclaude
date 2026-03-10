#!/bin/bash
# Stop Hook (Ralph): 작업 미완료 시 중단 차단
# Ralph 모드 활성 + 미완료 → JSON decision "block" 반환으로 Claude 계속 진행
# Claude Code Stop hook 공식 프로토콜 사용

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RALPH_STATE="$PROJECT_ROOT/.claude/.ralph_state"

# Ralph 상태 파일 없으면 즉시 종료
[ ! -f "$RALPH_STATE" ] && exit 0

# stdin에서 Stop hook input 읽기
INPUT=$(cat)

# stop_hook_active 체크 — 이미 Stop hook에 의해 계속 중이면 무한 루프 방지
STOP_ACTIVE=$(echo "$INPUT" | grep -o '"stop_hook_active":true' | head -1)
if [ -n "$STOP_ACTIVE" ]; then
    exit 0
fi

# 상태 파싱 — jq 우선, bash fallback
if command -v jq >/dev/null 2>&1; then
    ACTIVE=$(jq -r '.active // false' "$RALPH_STATE" 2>/dev/null)
    STATUS=$(jq -r '.status // "unknown"' "$RALPH_STATE" 2>/dev/null)
    ITERATION=$(jq -r '.iteration // 0' "$RALPH_STATE" 2>/dev/null)
    GOAL=$(jq -r '.goal // ""' "$RALPH_STATE" 2>/dev/null)
else
    ACTIVE=$(grep -o '"active":\s*true' "$RALPH_STATE" | head -1)
    [ -n "$ACTIVE" ] && ACTIVE="true" || ACTIVE="false"
    STATUS=$(grep -o '"status":"[^"]*"' "$RALPH_STATE" | head -1 | sed 's/"status":"//;s/"$//')
    ITERATION=$(grep -o '"iteration":[0-9]*' "$RALPH_STATE" | head -1 | grep -o '[0-9]*')
    GOAL=$(grep -o '"goal":"[^"]*"' "$RALPH_STATE" | head -1 | sed 's/"goal":"//;s/"$//')
fi

# 활성 + 미완료일 때만 차단
if [ "$ACTIVE" = "true" ] && [ "$STATUS" != "completed" ]; then
    # Claude Code Stop hook 공식 프로토콜: JSON decision "block"
    cat <<EOF
{
  "decision": "block",
  "reason": "prompt",
  "systemMessage": "Ralph 모드 활성: 태스크 미완료 상태입니다. .claude/.ralph_state를 확인하고 작업을 계속하세요."
}
EOF
fi
