---
description: "Telegram 메신저 알림 설정/테스트/토글"
allowed-tools: [Bash]
---

Telegram 메신저 알림 명령

## 인자 처리

- `$ARGUMENTS`를 확인한다
- `config <bot_token> <chat_id>` → 봇 토큰과 채팅 ID 설정
- `test` → 테스트 메시지 전송
- `on` → 알림 활성화
- `off` → 알림 비활성화
- `send "메시지"` → 메시지 전송
- `status` → 현재 설정 상태 표시
- `notify` → 세션 종료 알림 전송 (Stop hook 전용, 직접 호출도 가능)
- 인자 없음 → 도움말 표시

## 실행

아래 bash 명령을 **한 번에** 실행하고 결과만 보고한다. 사용자에게 확인을 묻지 않는다.

```bash
ARGS="$ARGUMENTS"
SCRIPT=".claude/scripts/messenger.sh"

if [ -z "$ARGS" ]; then
  # 도움말 출력
  echo ""
  echo "## dotclaude-messenger — Telegram 알림 설정"
  echo ""
  echo "사용법:"
  echo "  /project:dotclaude-messenger config <bot_token> <chat_id>  봇 설정"
  echo "  /project:dotclaude-messenger test                          테스트 전송"
  echo "  /project:dotclaude-messenger on                            알림 활성화"
  echo "  /project:dotclaude-messenger off                           알림 비활성화"
  echo "  /project:dotclaude-messenger send \"메시지\"               메시지 전송"
  echo "  /project:dotclaude-messenger status                        설정 상태 확인"
  echo "  /project:dotclaude-messenger notify                        세션 종료 알림 (Stop hook 전용)"
  echo ""
  echo "설정 파일: ~/.claude/messenger.json"
  echo ""
else
  bash "$SCRIPT" $ARGS
fi
```
