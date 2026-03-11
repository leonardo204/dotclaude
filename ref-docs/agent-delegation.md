# Agent Delegation — 에이전트 위임 규칙, 파이프라인 흐름, 호출 패턴 상세

## 필수 트리거

| 트리거 조건 | Agent 유형 | 이유 |
|-------------|-----------|------|
| 파일 3개 이상 읽기/수정 필요 | general-purpose | 컨텍스트 보호 |
| 멀티스텝 실행 (5단계 이상) | general-purpose | 자율 실행이 효율적 |
| 복잡한 기능 구현 | 구현 파이프라인 | 다중 에이전트 협업 |
| /dotclaude-init, /dotclaude-update | general-purpose | repo 클론+파일 복사+검증 |
| 코드베이스 구조 파악 | Explore | 탐색 특화 |
| 독립 작업 2개 이상 동시 | Agent 병렬 생성 | 처리량 극대화 |
| 빌드/테스트/설치 등 장시간 | Agent (run_in_background) | 블로킹 방지 |

## 직접 처리 (Agent 불필요)

| 상황 | 접근 |
|------|------|
| 단일 파일 읽기/수정 | Read, Edit |
| 특정 클래스/함수 검색 | Glob, Grep |
| 사용자 질문에 즉답 | 직접 응답 |
| 간단한 1-2단계 작업 | 직접 실행 |

## 위임 패턴

### DB 핸드오프 프로토콜 (기본)

```
메인: helper.sh agent-task <name> "태스크 내용" → DB에 저장
메인: Agent(prompt: ".claude/agents/<name>.md의 지침을 따라 작업하라. 태스크: <name>")
Agent: DB에서 태스크 조회 → 실행 → DB에 결과 보고
메인: helper.sh agent-result <name> → 결과 확인
```

### 프롬프트 직접 전달 (단순 작업)

태스크가 1-2줄로 충분한 경우, DB 핸드오프 없이 프롬프트에 직접 포함.

### 병렬 실행

- 독립 작업 2개 이상 → 단일 메시지에 Agent 도구 여러 개 호출
- 의존 관계 있으면 → 순차 실행

### Agent 간 컨텍스트 공유

```
Agent A: helper.sh agent-context <key> "공유 정보" → DB에 저장
Agent B: helper.sh agent-context <key> → DB에서 조회
```

## 커스텀 에이전트

호출 방법: `subagent_type: "general-purpose"`로 Agent 생성 후, 프롬프트 첫 줄에 `.claude/agents/<name>.md`를 Read하여 지침 포함. `subagent_type`에 커스텀 이름 직접 지정하면 에러.

| 에이전트 | 역할 | 모델 | 수정 권한 |
|----------|------|:----:|:---------:|
| planner | 요청 분석 → 태스크 분해 + 수용 기준 정의 | sonnet | ❌ |
| architect | 설계/구현 검토 + 아키텍처 타당성 검증 | sonnet | ❌ |
| ralph | 끈질긴 구현 — 완료+검증될 때까지 절대 중단 안 함 | sonnet | ✅ |
| verifier | 빌드/테스트/타입체크 증거 기반 검증 | haiku | ❌ |
| reviewer | 코드 리뷰 — 보안/정확성/품질 | sonnet | ❌ |
| debugger | 버그/에러 근본 원인 진단 | sonnet | ❌ |
| test-engineer | 테스트 전략 수립 + 테스트 코드 작성 | sonnet | ✅ |

호출 예시:

```
Agent(subagent_type: "general-purpose", prompt: "
.claude/agents/ralph.md의 지침을 따라 작업하라.
[태스크 내용...]
")
```

## 구현 파이프라인

```
요청 → planner → 승인 → architect → 승인 → ralph + test-engineer → verifier → reviewer → 완료
```

- 계획/설계: 사용자 승인 루프
- 구현/검증/리뷰: 자동 실행, 실패 시 debugger 진단 → ralph 재진입

### 자동 트리거 조건

| 감지 패턴 | 예시 | 동작 |
|-----------|------|------|
| 새 기능 구현 요청 + 2개 이상 파일 수정 예상 | "로그인 기능 추가해줘" | 파이프라인 제안 → 승인 시 실행 |
| 아키텍처 변경이 수반되는 요청 | "인증을 JWT에서 세션으로 바꿔줘" | 파이프라인 제안 |
| "구현해줘", "만들어줘" + 구체적 기능 명세 | "댓글 시스템 구현해줘" | 파이프라인 제안 |
| 단순 수정/버그픽스 | "이 에러 고쳐줘" | 직접 처리 또는 ralph 단독 |

판단 기준: 계획+설계가 필요한 규모인가? → Yes면 파이프라인, No면 직접/ralph

## 모호한 요청 대응

요청이 모호한 경우 (대상 없는 추상적 동사, 파일/함수 미지정, 3개 이상 영역, 명확한 산출물 없음):
→ 탐색(Explore) → 계획(Plan) → 구현 순서로 진행.
