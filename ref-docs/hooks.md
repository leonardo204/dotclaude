# Hooks — 5개 자동 실행 Hook의 역할, 시점, 최적화 설명

## Hook 목록

| Hook | 시점 | 역할 |
|------|------|------|
| session-start.sh | SessionStart (세션 시작) | DB 초기화, 세션 기록, CLAUDE.md 지침 캐시, 7일+ 데이터 정리, 미완료 태스크 표시 |
| on-prompt.sh | UserPromptSubmit (매 턴) | 3단계 차등 주입 (기본/경고/복구) |
| post-tool-edit.sh | PostToolUse:Edit/Write (파일 편집 후) | tool_usage에 편집 기록 + .sh 파일 Write 시 auto chmod +x |
| post-tool-bash.sh | PostToolUse:Bash (Bash 실행 후) | 에러 시에만 분류/로깅 + error_context 자동 캡처 |
| on-stop.sh | Stop (세션 종료) | 세션 통계 업데이트 + duration_minutes 자동 계산 + session_summary 저장 |

## stdout 가시성 제약

| Hook 시점 | stdout 주입 가능 | 용도 |
|-----------|:---:|------|
| SessionStart | ✅ | 세션 시작 메시지, 미완료 태스크 |
| UserPromptSubmit | ✅ | 컨텍스트 주입 (rules, errors, live context) |
| PostToolUse | ❌ | 백그라운드 DB 기록만 |
| Stop | ❌ | JSON 프로토콜만 (`{"decision":"block"}`) |

## on-prompt.sh 3단계 차등 주입

### 기본 모드 (ctx < 70%)

- 세션 ID, 편집 파일 수, 미완료 태스크 수만 1줄 출력
- sqlite3 1회 호출 (3개 서브쿼리 병합)

### 경고 모드 (ctx 70~90%)

- 기본 + live_context 덤프, 최근 결정, 미완료 태스크, 최근 에러 추가 주입
- working_files를 tool_usage에서 추출해 live_context에 저장

### 복구 모드 (compaction 감지)

- live_context 전체 복구 주입
- 복구 후 기본 모드로 전환

## 성능 최적화

- post-tool-edit.sh: sqlite3 INSERT를 `&` (fire-and-forget)으로 실행, .sh chmod도 `&` 백그라운드
- post-tool-bash.sh: 에러 없으면 sqlite3 호출 자체를 스킵
- on-prompt.sh 기본 모드: sqlite3 1회 blocking (서브쿼리 병합으로 fork 최소화)
- session-start.sh: INSERT + DELETE를 단일 sqlite3 호출로 병합, CLAUDE.md 캐시는 non-blocking

## Hook 아키텍처: global vs project-local

### 단일 진입점 원칙

**모든 hook은 bridge.js(Node.js)를 단일 진입점으로 사용한다.** bash 스크립트를 직접 호출하지 않는다.

```
settings.json → bridge.js (HOOK_EVENT=xxx) → DB 처리
                   ↓ fallback
              ~/.claude/dist/hooks/bridge.js
```

### 경로 해석 순서

```bash
_B="$(project_root)/.claude/dist/hooks/bridge.js"  # 1. 프로젝트 로컬
[ -f "$_B" ] || _B="$HOME/.claude/dist/hooks/bridge.js"  # 2. 글로벌 fallback
```

### global/settings.json vs project-local/settings.json

| 항목 | global/ | project-local/ |
|------|---------|----------------|
| 설치 위치 | `~/.claude/settings.json` | `.claude/settings.json` |
| statusLine | 포함 (HUD 활성) | 미포함 (dotclaude-init 시 선택) |
| Hook 명령 | bridge.js | bridge.js (동일) |
| 적용 범위 | 모든 프로젝트 | 해당 프로젝트만 |

**두 settings 모두 Claude Code에 로드되며 hooks는 additive(합산) 실행된다.**
각 hook 스크립트(bridge.js, fetcher.js)는 중복 호출을 내부적으로 처리한다.

### init/update 시 호환성 규칙

1. **settings.json의 hooks 섹션은 반드시 `project-local/settings.json`에서 복사** — 내용을 기억해서 작성 금지
2. **PostToolUse 포함 모든 hook은 bridge.js를 호출** — bash 스크립트 직접 호출 금지 (bridge.js가 없는 환경에서 hook error 발생)
3. **`project-local/hooks/*.sh`는 레거시** — bridge.js 내부에 동일 로직이 번들되어 있음. settings.json에서 참조하지 않음
4. **`global/settings.json`과 `project-local/settings.json`의 hooks 섹션은 동일하게 유지** (statusLine만 다름)
5. **dotclaude-update는 hooks 섹션을 시스템 최신으로 교체** — 사용자 커스텀 hooks는 별도 matcher로 추가

## 데이터 정리

session-start.sh가 세션 시작 시 자동 실행:

- `tool_usage`: 7일 이상 된 데이터 삭제
- `errors`: 7일 이상 된 데이터 삭제
- `live_context`: working_files, error_context, _result:*, _task:* 키 리셋
