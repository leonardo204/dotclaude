# 골든 기준선 — TS 전환 전 bash CLI 출력

`messenger.sh`(bash 596줄)를 TypeScript로 전환하기 **전에** 캡처한 출력.
전환 후 동일 명령의 출력이 이것과 일치해야 하위 호환이 보장된다.

## 캡처 조건 (재현 방법)

합성 HOME을 써서 실제 사용자 설정에 의존하지 않는다(밀폐):

    HOME=<fake> bash messenger.sh <cmd>

합성 설정: `{bot_token:"1234567890:TEST_TOKEN_NOT_REAL_...", chat_id:"999999999",
enabled:true, min_duration:300, scope:"global"}`

## 엄격 비교 대상 (바이트 동일해야 함)

- `status.txt` · `get-enabled.txt` · `get-min_duration.txt` · `get-scope.txt` · `get-chat_id.txt`
- 각 `*.exit` = 종료 코드

## 의도된 변경 (diff 0 아님)

- `help.txt` / `unknown.txt` — 도움말 예시를 `<BOT_TOKEN>` / `<CHAT_ID>` 로 치환해 뒀다.
  기준선을 캡처하던 시점의 원본 bash 출력에는 **실제 봇 토큰 앞부분과 실제 chat_id가
  하드코딩**돼 있었기 때문이다(아래 참조). 기준선에 그대로 담으면 유출 사본이
  하나 더 생기므로 치환했다. TS는 기준선(placeholder) 쪽을 따른다.

  > **경위 (2026-07-17):** `messenger.sh:44` 의 도움말 예시에 **개발자의 실제
  > chat_id 원문과 실제 봇 토큰 앞부분**이 하드코딩돼 있었다. 커밋 `600b560`
  > (기능 도입)부터 `834abba`(수정)까지 공개 저장소에 존재했다.
  > 토큰은 잘려 있어 재구성은 불가능하나 chat_id 는 원문이었다.
  > 값 자체는 여기 옮기지 않는다 — 유출을 설명하려다 사본을 하나 더 만드는 꼴이다.
  > 확인이 필요하면 `git show 834abba -- project-local/scripts/messenger.sh` 를 보라.
  >
  > 현재 예시값은 그 수정으로 넣은 placeholder 이지 원본이 아니다.
  > **수정 후 파일만 보고 "원래 더미였다"고 오판하기 쉽다** — 실제로 그런 오독이
  > 한 차례 있었다. 원본을 확인하려면 반드시 git 히스토리를 보라.

  두 파일은 "실값이 없을 것" + "구조가 같을 것"을 검증한다
  (실제로는 정규화 후 바이트 동일까지 통과한다).

## 현황 — 전환 완료 (TS)

구현은 `src/messenger/`로 옮겨졌고 `scripts/messenger.sh`는 얇은 래퍼가 됐다.
대조는 **`test/messenger-golden.test.mjs`가 `npm test`에서 자동 수행**한다.
위 7개 파일 전부(엄격 5 + help/unknown) 바이트 동일로 통과한다.

테스트가 골든과 다르게 하는 일은 하나뿐이다:

- **HOME 경로 정규화** — 골든에는 캡처 당시 합성 HOME의 절대경로가 박혀 있고
  (`status`/`help`의 "설정 파일:" 줄) 테스트는 매번 새 임시 HOME을 쓴다.
  `\S*/.claude/messenger.json` → `{CONFIG}` 치환만 적용하고 나머지는 그대로 대조한다.
  색상 이스케이프(`\033[...`)는 정규화하지 않는다 — 별도 테스트로 존재를 못박아,
  정규화가 이스케이프를 지워 통과하는 일이 없게 했다.

재캡처가 필요하면 원본 bash는 `git show <전환 이전 커밋>:project-local/scripts/messenger.sh`
로 꺼낼 수 있다.
