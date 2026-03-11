# Hooks — 5개 자동 실행 Hook의 역할, 시점, 최적화 설명

## Hook 목록

| Hook | 시점 | 역할 |
|------|------|------|
| session-start.sh | SessionStart (세션 시작) | DB 초기화, 세션 기록, CLAUDE.md 지침 캐시, 7일+ 데이터 정리, 미완료 태스크 표시 |
| on-prompt.sh | UserPromptSubmit (매 턴) | 3단계 차등 주입 (기본/경고/복구) |
| post-tool-edit.sh | PostToolUse:Edit (파일 편집 후) | tool_usage에 편집 기록 (working_files·session_summary의 데이터 소스) |
| post-tool-bash.sh | PostToolUse:Bash (Bash 실행 후) | 에러 시에만 분류/로깅 + error_context 자동 캡처 |
| on-stop.sh | Stop (세션 종료) | 세션 통계 업데이트 + session_summary 자동 저장 |

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

- post-tool-edit.sh: sqlite3 INSERT를 `&` (fire-and-forget)으로 실행
- post-tool-bash.sh: 에러 없으면 sqlite3 호출 자체를 스킵
- on-prompt.sh 기본 모드: sqlite3 1회 blocking (서브쿼리 병합으로 fork 최소화)
- session-start.sh: INSERT + DELETE를 단일 sqlite3 호출로 병합, CLAUDE.md 캐시는 non-blocking

## 데이터 정리

session-start.sh가 세션 시작 시 자동 실행:

- `tool_usage`: 7일 이상 된 데이터 삭제
- `errors`: 7일 이상 된 데이터 삭제
- `live_context`: working_files, error_context, _result:*, _task:* 키 리셋
