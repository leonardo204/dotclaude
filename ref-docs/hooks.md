# Hooks — 자동 실행 Hook의 역할, 시점, 아키텍처

## 단일 진입점: bridge.js

**모든 hook은 `dist/hooks/bridge.js`(TypeScript 빌드 산출물)를 단일 진입점으로 사용한다.** bash 스크립트를 직접 호출하지 않는다. `settings.json`은 `HOOK_EVENT` 환경변수로 이벤트를 구분해 bridge.js를 호출하고, bridge.js가 `src/hooks/events/*.ts`의 핸들러로 디스패치한다.

```
settings.json → HOOK_EVENT=xxx bridge.js → events/xxx.ts 핸들러 → DB/stdout
                   ↓ 경로 해석
              1. <project>/.claude/dist/hooks/bridge.js   (프로젝트 로컬)
              2. ~/.claude/dist/hooks/bridge.js            (글로벌 fallback)
```

> 과거의 `hooks/*.sh`(session-start.sh, on-prompt.sh 등)는 **제거됨** — 동일 로직이 bridge.js(TS)에 번들돼 있다.

## Hook 목록

| 이벤트 | HOOK_EVENT | 핸들러 | 역할 |
|--------|-----------|--------|------|
| SessionStart | `session-start` | `events/session-start.ts` | DB 초기화·세션 기록, CLAUDE.md 지침 캐시(`_rules`/`_project_rules`), 7일+ 데이터 정리, 직전 세션 handoff 주입 |
| UserPromptSubmit | `prompt` | `events/prompt.ts` | 3단계 차등 컨텍스트 주입(기본/경고/복구) + messenger 시작 시각 기록 |
| PostToolUse (Edit\|Write) | `post-edit` | `events/post-edit.ts` | `tool_usage`에 편집 기록 + `.sh` 파일 Write 시 auto chmod +x |
| PostToolUse (Bash) | `post-bash` | `events/post-bash.ts` | **성공한** Bash 출력에 에러 문구가 있으면 분류·기록(오탐 게이트 `looksLikeError`) |
| PostToolUseFailure (Bash) | `post-bash-fail` | `events/post-bash-failure.ts` | **실패한** Bash를 기록. 페이로드의 `error`(exit code 포함)·`is_interrupt`(ESC 중단 제외) 사용 |
| Stop | `stop` | `events/stop.ts` | 통합 핸들러(아래) |

추가로 `SessionStart`/`UserPromptSubmit`에서 HUD rate-limit 폴백 데몬 `dist/hud/fetcher.js`를 `&`(백그라운드)로 스폰한다. → [Context Monitor](context-monitor.md)

### PostToolUse vs PostToolUseFailure

Claude Code는 도구 **성공** 시 `PostToolUse`, **실패**(non-zero exit) 시 `PostToolUseFailure`를 발동한다. 그래서 에러 로깅은 두 경로로 나뉜다: `post-bash`는 "성공했지만 출력에 에러 문구가 있는" 경우(오탐 방지 게이트 필요), `post-bash-fail`은 발동 자체가 실패 확정이므로 게이트 없이 분류만 한다. 실패 페이로드는 `tool_response`가 없고 `error`/`is_interrupt`가 최상위에 온다(실측).

### Stop 통합 핸들러 (`events/stop.ts`)

과거 Stop 이벤트에 3개 훅(`stop-session` + `stop-ralph` + `messenger.sh notify &`)이 **병렬** 등록돼, 알림이 handoff 기록보다 먼저 읽는 경합이 있었다. 이를 단일 핸들러로 통합해 순서를 코드로 보장한다:

1. 세션 통계 + `session_summary`/`session_handoff` 기록 (`stop-session.ts` 모듈)
2. ralph 판정 — active+미완료면 block 응답 반환 (`stop-ralph.ts` 모듈, 순수 함수)
3. 알림 전송 (`messenger/notify.ts`) — 1 이후라 handoff 경합 없음
4. block이면 stdout에 JSON 1개만 출력

`stop-session.ts`·`stop-ralph.ts`는 독립 훅이 아니라 `stop.ts`가 호출하는 모듈이다.

## stdout 가시성 제약

| 이벤트 | stdout 주입 | 용도 |
|--------|:---:|------|
| SessionStart | ✅ | 세션 시작 메시지, handoff, rules |
| UserPromptSubmit | ✅ | 컨텍스트 주입(rules, errors, live_context) |
| PostToolUse / PostToolUseFailure | ❌ | 백그라운드 DB 기록만 (stdout 0바이트) |
| Stop | ❌ | JSON 프로토콜만 (`{"decision":"block"}`) — 디버그 로그는 stderr로 |

## prompt.ts 3단계 차등 주입

`.claude/.ctx_state`의 `alert` 값(statusline이 기록)으로 분기한다. → [Context Monitor](context-monitor.md)

| 모드 | 조건 | 동작 |
|------|------|------|
| 기본 | `alert=none` | 세션 ID·편집 파일 수만 1줄 출력 |
| 경고 | `alert=high` (ctx ≥70%) | `working_files` 자동 저장 + 저장 리마인더 주입 |
| 복구 | `alert=compacted` (급감 감지) | `live_context` 전체 + 최근 decisions/errors 재주입, `restored_at` 스탬프로 중복 복구 방지 |

## Hook 아키텍처: global vs project-local

### 경로 해석

```bash
_B="$(project_root)/.claude/dist/hooks/bridge.js"       # 1. 프로젝트 로컬
[ -f "$_B" ] || _B="$HOME/.claude/dist/hooks/bridge.js"  # 2. 글로벌 fallback
```

### settings 관계

| 항목 | global/ | project-local/ |
|------|---------|----------------|
| 설치 위치 | `~/.claude/settings.json` | `.claude/settings.json` |
| statusLine | 포함 (HUD 활성) | 미포함 (dotclaude-init 시 선택) |
| hooks 섹션 | bridge.js (동일) | bridge.js (동일) |

**두 settings 모두 로드되며 hooks는 additive(합산) 실행된다.** bridge.js·fetcher.js는 중복 호출을 내부적으로 처리(PID 락 등)한다.

### init/update 호환성 규칙

1. **hooks 섹션은 dotclaude repo의 `manifest.json` 기반 배포로만 교체** — 내용을 기억해서 작성 금지
2. **모든 hook은 bridge.js 호출** — bash 스크립트 직접 호출 금지(bridge.js 부재 환경에서 hook error).
3. **`global/settings.json`과 `project-local/settings.json`의 hooks 섹션은 동일하게 유지**(statusLine만 다름).
4. **dotclaude-update는 hooks 섹션을 시스템 최신으로 교체** — 사용자 커스텀 hook은 별도 matcher로 추가.

## 데이터 정리

`session-start`가 세션 시작 시 자동 실행:

- `tool_usage` / `errors`: 7일 이상 된 데이터 삭제
- `live_context`: `working_files`, `error_context`, `_result:*`, `_task:*` 키 리셋
