---
description: "Telegram 메신저 알림 설정/테스트/토글 — 대화형 가이드 포함"
allowed-tools: [Bash, AskUserQuestion]
---

Telegram 메신저 알림 명령

## 인자 처리

- `$ARGUMENTS`를 확인한다
- 인자가 있으면 → bash로 즉시 실행하고 종료
- 인자 없음 → 대화형 가이드 (AskUserQuestion 사용)

```bash
ARGS="$ARGUMENTS"
SCRIPT=".claude/scripts/messenger.sh"

if [ -n "$ARGS" ]; then
  bash "$SCRIPT" $ARGS
  exit 0
fi
```

인자가 없으면 아래 대화형 가이드를 진행한다.

## 대화형 가이드

### 단계 1: 설정 상태 확인

```bash
CONFIG_FILE="${HOME}/.claude/messenger.json"
if [ ! -f "${CONFIG_FILE}" ]; then
  echo "NO_CONFIG"
elif ! BOT_TOKEN=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.bot_token||'')" 2>/dev/null) || [ -z "${BOT_TOKEN}" ]; then
  echo "NO_TOKEN"
else
  ENABLED=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(String(c.enabled===false?'false':'true'))" 2>/dev/null || echo "true")
  MIN_DUR=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(String(c.min_duration||0))" 2>/dev/null || echo "0")
  SCOPE=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.scope||'global')" 2>/dev/null || echo "global")
  echo "CONFIGURED:${ENABLED}:${MIN_DUR}:${SCOPE}"
fi
```

### 단계 2: 분기

결과가 `NO_CONFIG` 또는 `NO_TOKEN` → **봇 미설정 플로우**
결과가 `CONFIGURED:...` → **설정 완료 메뉴**

---

## 봇 미설정 플로우

### Step A: 초기 안내

먼저 아래 안내를 텍스트로 출력한다:

```
Telegram 봇이 아직 설정되지 않았습니다.

1단계: Telegram에서 @BotFather 검색 → /newbot → 봇 생성 → Bot Token 복사
2단계: 봇에게 아무 메시지 전송 → https://api.telegram.org/bot<TOKEN>/getUpdates 접속 → chat.id 확인
```

### Step B: AskUserQuestion으로 토큰 입력 요청

AskUserQuestion 호출:
- question: "Bot Token을 입력해주세요 (BotFather에서 받은 토큰)"
- header: "Bot Token"
- options:
  - label: "설정 건너뛰기", description: "나중에 /dotclaude-messenger config <token> <chat_id>로 설정"
  - label: "설정 방법 다시 보기", description: "BotFather 설정 절차를 다시 안내"

사용자가 "Other"로 토큰을 직접 입력하면 다음 단계로 진행.
"설정 건너뛰기" 선택 시 즉시 종료.

### Step C: AskUserQuestion으로 Chat ID 입력 요청

AskUserQuestion 호출:
- question: "Chat ID를 입력해주세요 (getUpdates에서 확인한 숫자)"
- header: "Chat ID"
- options:
  - label: "설정 건너뛰기", description: "나중에 설정"
  - label: "Chat ID 확인 방법", description: "getUpdates API로 확인하는 방법 안내"

사용자가 "Other"로 Chat ID를 직접 입력하면 config 실행.

### Step D: config + test 실행

```bash
bash .claude/scripts/messenger.sh config "<TOKEN>" "<CHAT_ID>"
bash .claude/scripts/messenger.sh test
```

테스트 성공 시 → 설정 완료 메뉴로 이동하여 추가 설정 제안.
테스트 실패 시 → 토큰/ID 재입력 안내.

---

## 설정 완료 메뉴

`CONFIGURED:ENABLED:MIN_DUR:SCOPE` 값을 파싱하여 현재 상태를 텍스트로 한 줄 표시한 후, AskUserQuestion으로 메뉴를 제공한다.

**현재 상태 표시 예시:**
```
현재: 활성화 | 최소 10분 | 글로벌
```

### 메인 메뉴: AskUserQuestion

AskUserQuestion 호출:
- question: "무엇을 하시겠습니까?"
- header: "Messenger"
- options:
  - label: "테스트 전송", description: "Telegram으로 테스트 메시지를 보냅니다"
  - label: "알림 설정", description: "on/off, 최소 시간, 범위 등 알림 조건 변경"
  - label: "봇 변경", description: "Bot Token / Chat ID 재설정"
  - label: "메시지 전송", description: "원하는 메시지를 직접 Telegram으로 전송"

사용자가 "Other"로 입력하면 해당 내용을 해석하여 처리한다 (예: "skip", "종료" → 가이드 종료).

### 테스트 전송 선택 시

```bash
bash .claude/scripts/messenger.sh test
```

### 알림 설정 선택 시

AskUserQuestion으로 세부 설정 메뉴 제공:
- question: "어떤 설정을 변경하시겠습니까?"
- header: "알림 설정"
- options:
  - label: "on/off 토글", description: "현재 {ENABLED 상태}. 반대로 전환합니다"
  - label: "최소 알림 시간", description: "현재 {MIN_DUR}. N분 이상 작업만 알림"
  - label: "알림 범위", description: "현재 {SCOPE}. 글로벌 또는 프로젝트별 선택"
  - label: "건너뛰기", description: "메인 메뉴로 돌아갑니다"

#### on/off 토글 선택 시

```bash
# ENABLED가 true이면:
bash .claude/scripts/messenger.sh off
# ENABLED가 false이면:
bash .claude/scripts/messenger.sh on
```

#### 최소 알림 시간 선택 시

AskUserQuestion 호출:
- question: "몇 분 이상 작업에만 알림을 받겠습니까?"
- header: "최소 시간"
- options:
  - label: "제한 없음", description: "모든 작업에 알림 (0초)"
  - label: "5분", description: "5분 미만 작업은 알림 스킵 (300초)"
  - label: "10분 (추천)", description: "10분 미만 작업은 알림 스킵 (600초)"
  - label: "30분", description: "30분 미만 작업은 알림 스킵 (1800초)"

"Other"로 직접 분 단위 입력 가능. 입력값을 초로 변환하여 실행:
```bash
bash .claude/scripts/messenger.sh set min_duration <초>
```

#### 알림 범위 선택 시

AskUserQuestion 호출:
- question: "알림 범위를 설정하세요"
- header: "범위"
- options:
  - label: "글로벌 (추천)", description: "모든 프로젝트에서 알림"
  - label: "프로젝트별", description: ".claude/.messenger_enabled 파일이 있는 프로젝트만 알림"

```bash
bash .claude/scripts/messenger.sh set scope <global|project>
```

project 선택 시 추가 AskUserQuestion:
- question: "현재 프로젝트에서 알림을 활성화할까요?"
- header: "프로젝트"
- options:
  - label: "활성화", description: "이 프로젝트에 .claude/.messenger_enabled 생성"
  - label: "건너뛰기", description: "나중에 수동으로 설정"

활성화 선택 시:
```bash
touch .claude/.messenger_enabled
```

### 봇 변경 선택 시

봇 미설정 플로우의 Step B부터 동일하게 진행한다.

### 메시지 전송 선택 시

AskUserQuestion 호출:
- question: "전송할 메시지를 입력하세요"
- header: "메시지"
- options:
  - label: "건너뛰기", description: "메시지 전송을 취소합니다"
  - label: "현재 상태 전송", description: "현재 설정 상태를 Telegram으로 전송"

"Other"로 직접 메시지 입력:
```bash
bash .claude/scripts/messenger.sh send "<입력된_메시지>"
```

### 메뉴 반복

각 작업 완료 후 AskUserQuestion 호출:
- question: "계속 설정하시겠습니까?"
- header: "계속"
- options:
  - label: "메뉴로 돌아가기", description: "메인 메뉴를 다시 표시합니다"
  - label: "종료", description: "설정을 마칩니다"

"메뉴로 돌아가기" → 메인 메뉴 AskUserQuestion 다시 실행
"종료" 또는 "Other"에 "skip"/"종료"/"q" → 가이드 종료
