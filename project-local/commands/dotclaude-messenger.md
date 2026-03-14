---
description: "Telegram 메신저 알림 설정/테스트/토글 — 대화형 가이드 포함"
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
- `set min_duration <초>` → 최소 알림 시간 설정
- `set scope <global|project>` → 알림 범위 설정
- `get <key>` → 설정값 조회
- 인자 없음 → 대화형 가이드 실행

## 실행

인자가 있으면 즉시 실행하고 결과를 보고한다.
인자가 없으면 아래 대화형 가이드를 진행한다.

```bash
ARGS="$ARGUMENTS"
SCRIPT=".claude/scripts/messenger.sh"
CONFIG_FILE="${HOME}/.claude/messenger.json"

if [ -n "$ARGS" ]; then
  bash "$SCRIPT" $ARGS
  exit 0
fi
```

인자가 없으면 아래 순서로 대화형 가이드를 진행한다. **bash 코드 블록으로 실행하지 말고 Claude가 직접 대화를 이끈다.**

## 대화형 가이드 (인자 없음)

### 단계 1: 봇 설정 상태 확인

먼저 현재 설정 상태를 확인한다.

```bash
CONFIG_FILE="${HOME}/.claude/messenger.json"
SCRIPT=".claude/scripts/messenger.sh"

# 설정 상태 판단
if [ ! -f "${CONFIG_FILE}" ]; then
  echo "NO_CONFIG"
elif ! BOT_TOKEN=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.bot_token||'')" 2>/dev/null) || [ -z "${BOT_TOKEN}" ]; then
  echo "NO_TOKEN"
else
  ENABLED=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(String(c.enabled===false?'false':'true'))" 2>/dev/null || echo "true")
  MIN_DUR=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(String(c.min_duration||0))" 2>/dev/null || echo "0")
  SCOPE=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.scope||'global')" 2>/dev/null || echo "global")

  # 활성화 상태 표시
  if [ "${ENABLED}" = "true" ]; then
    STATUS_STR="활성화"
  else
    STATUS_STR="비활성화"
  fi

  # 최소 알림 시간 표시
  if [ "${MIN_DUR}" -gt 0 ] 2>/dev/null; then
    if [ "${MIN_DUR}" -ge 3600 ] 2>/dev/null; then
      MIN_STR="$((MIN_DUR/3600))시간"
    elif [ "${MIN_DUR}" -ge 60 ] 2>/dev/null; then
      MIN_STR="$((MIN_DUR/60))분"
    else
      MIN_STR="${MIN_DUR}초"
    fi
  else
    MIN_STR="제한 없음"
  fi

  echo "CONFIGURED:${STATUS_STR}:${MIN_STR}:${SCOPE}"
fi
```

### 단계 2: 결과에 따라 분기

위 확인 결과가 `NO_CONFIG` 또는 `NO_TOKEN` 이면 **봇 미설정 플로우**를 진행하고,
`CONFIGURED:...` 이면 **설정 완료 메뉴**를 표시한다.

---

## 봇 미설정 플로우

상태가 `NO_CONFIG` 또는 `NO_TOKEN` 이면 아래 순서로 안내한다.

Claude가 직접 다음 내용을 사용자에게 출력하고 단계별로 진행한다:

---

**Telegram Bot 설정 안내**

Telegram 봇이 아직 설정되지 않았습니다. 아래 단계로 설정합니다.

**1단계: BotFather에서 봇 생성**
1. Telegram에서 @BotFather 를 검색하여 대화를 시작합니다
2. `/newbot` 명령을 입력합니다
3. 봇 이름을 입력합니다 (예: My Claude Bot)
4. 봇 사용자명을 입력합니다 (예: my_claude_bot — 반드시 `_bot` 으로 끝나야 합니다)
5. BotFather가 Bot Token을 제공합니다 (예: `1234567890:AAE3eebo...`)

**2단계: Chat ID 확인**
1. 방금 만든 봇에게 아무 메시지나 보냅니다 (예: "hello")
2. 브라우저에서 `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` 접속
3. 결과에서 `"chat":{"id":숫자}` 부분의 숫자가 Chat ID입니다

---

이 안내를 출력한 후 사용자에게 묻는다:

"Bot Token을 입력해주세요 (BotFather에서 받은 토큰):"

사용자가 토큰을 입력하면, 이어서 묻는다:

"Chat ID를 입력해주세요 (getUpdates에서 확인한 숫자):"

Chat ID까지 입력받으면 아래 bash를 실행한다:

```bash
SCRIPT=".claude/scripts/messenger.sh"
# 사용자가 입력한 TOKEN과 CHAT_ID로 설정
bash "$SCRIPT" config "<입력된_TOKEN>" "<입력된_CHAT_ID>"
```

설정 완료 후 테스트를 실행한다:

```bash
SCRIPT=".claude/scripts/messenger.sh"
bash "$SCRIPT" test
```

테스트 성공 시 다음을 안내한다:
- 알림은 Claude Code 세션이 종료될 때 자동으로 전송됩니다
- 최소 알림 시간 설정: `/dotclaude-messenger set min_duration 300` (5분 미만 작업 스킵)
- 알림 범위 설정: `/dotclaude-messenger set scope project` (특정 프로젝트만 알림)

---

## 설정 완료 메뉴

상태가 `CONFIGURED:STATUS:MIN:SCOPE` 이면 아래 메뉴를 표시한다.

`CONFIGURED:활성화:5분:global` 형태의 값을 파싱하여 현재 상태를 표시한 후, 아래 메뉴를 출력한다:

```
## dotclaude-messenger 설정

현재 상태: <STATUS> | 최소 알림 시간: <MIN> | 범위: <SCOPE>

1. 테스트 메시지 전송
2. 알림 on/off 토글
3. 최소 알림 시간 설정 (N분/시간 이상 작업만 알림)
4. 알림 범위 설정 (글로벌 / 현재 프로젝트만)
5. 봇 설정 변경 (Token / Chat ID)
6. 수동 메시지 전송

선택하세요 (1-6, 종료: q):
```

사용자 선택에 따라 아래를 실행한다:

**1번 — 테스트 메시지 전송:**
```bash
bash .claude/scripts/messenger.sh test
```

**2번 — 알림 on/off 토글:**
현재 상태를 확인하여 반대로 전환한다.
```bash
# ENABLED가 true이면:
bash .claude/scripts/messenger.sh off
# ENABLED가 false이면:
bash .claude/scripts/messenger.sh on
```

**3번 — 최소 알림 시간 설정:**
사용자에게 "몇 분 이상 작업에만 알림을 받겠습니까? (0 = 제한 없음):" 을 물은 후,
입력값을 초로 변환하여 설정한다.
```bash
# 입력이 5이면 300초
bash .claude/scripts/messenger.sh set min_duration <초>
```

**4번 — 알림 범위 설정:**
다음 선택지를 제시한다:
- `global`: 모든 프로젝트에서 알림 (기본값)
- `project`: `.claude/.messenger_enabled` 파일이 있는 프로젝트만 알림

사용자가 `project`를 선택하면 scope를 변경하고, 현재 프로젝트에 활성화 파일을 생성할지 묻는다.
```bash
bash .claude/scripts/messenger.sh set scope <global|project>
# project 선택 + 현재 프로젝트 활성화 시:
touch .claude/.messenger_enabled
```

**5번 — 봇 설정 변경:**
Bot Token과 Chat ID를 다시 입력받아 config 실행.
```bash
bash .claude/scripts/messenger.sh config "<새_TOKEN>" "<새_CHAT_ID>"
```

**6번 — 수동 메시지 전송:**
"전송할 메시지를 입력하세요:" 를 물은 후:
```bash
bash .claude/scripts/messenger.sh send "<입력된_메시지>"
```

각 기능 완료 후 "메뉴로 돌아가겠습니까? (y/n):" 를 묻고, y이면 메뉴를 다시 표시한다.
