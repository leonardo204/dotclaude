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

호출 방법: `subagent_type`에 에이전트명을 **직접 지정**한다. `.claude/agents/*.md`는 네이티브 subagent로 자동 등록되므로 planner/architect/ralph 등을 그대로 호출할 수 있다 (Opus 4.8 Claude Code). Workflow의 `agent(prompt, {agentType})`도 동일 레지스트리를 사용한다.

| 에이전트 | 역할 | 모델 | effort | 수정 권한 |
|----------|------|:----:|:----:|:---------:|
| planner | 요청 분석 → 태스크 분해 + 수용 기준 정의 | opus | high | ❌ |
| architect | 설계/구현 검토 + 아키텍처 타당성 검증 | opus | high | ❌ |
| ralph | 끈질긴 구현 — 완료+검증될 때까지 절대 중단 안 함 | opus | high | ✅ |
| verifier | 빌드/테스트/타입체크 증거 기반 검증 | sonnet | low | ❌ |
| reviewer | 코드 리뷰 — 보안/정확성/품질 | opus | high | ❌ |
| debugger | 버그/에러 근본 원인 진단 | opus | high | ❌ |
| test-engineer | 테스트 전략 수립 + 테스트 코드 작성 | sonnet | medium | ✅ |

호출 예시:

```
Agent(subagent_type: "ralph", prompt: "[태스크 내용...]")
```

> 레거시: 과거 `general-purpose` + `.md` Read 우회는 더 이상 불필요(Opus 4.8). 네이티브 직접 호출을 사용한다. 프롬프트에 태스크가 없으면 에이전트가 DB(`agent-task`)에서 조회한다.

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

## Workflow (대규모 결정적 오케스트레이션)

Workflow는 멀티에이전트 위임을 **코드로 결정화**한 상위 옵션이다. 우리 7개 에이전트는 네이티브 등록되어 `agent(prompt, {agentType: 'ralph'})`로 그대로 호출된다. 위임 자체를 버리는 게 아니라, "메인은 판단+위임" 원칙 위에서 위임을 **재현 가능한 스크립트**로 굳히는 것이다.

### 수동 위임 vs Workflow

| 상황 | 선택 |
|------|------|
| 소규모·일상 구현 | 수동 위임 (기본·가벼움) |
| 대규모(수십 파일·감사·마이그레이션)·재현 필요 | Workflow (opt-in) |
| 병렬 검증·다관점 투표·adversarial 리뷰 | Workflow (`parallel` + `schema`) |

### 발동 (명시적 opt-in 필수)

Workflow는 수십 에이전트를 spawn → 비용이 크다. **사용자가 "workflow"/"ultracode"를 명시하거나 대규모 작업을 요청할 때만** 발동한다. 일상 작업에 자동 발동 금지 — 기본은 수동 파이프라인.

### 번들 workflow

- `.claude/workflows/dotclaude-implement.js` — 구현 파이프라인(planner→architect→ralph+test-engineer→verifier→reviewer)을 결정적 스크립트로 표현. `agentType`으로 7 에이전트를 pipeline/parallel 오케스트레이션 + `schema` 판정.
- 실행: `Workflow(scriptPath: ".claude/workflows/dotclaude-implement.js", args: {request: "..."})`

### DB 연결 (세션 간 연속성과 결합)

Workflow 스크립트는 파일시스템/Bash 접근이 없다(`agent()`만 가능). 따라서 Context DB 기록은:
- (a) 마지막 phase에 ralph로 `bash .claude/db/helper.sh decision-add/commit-log` 실행을 위임, 또는
- (b) workflow 반환값을 메인이 받아 `helper.sh`로 DB 기록.

→ Workflow는 세션 **내** 조율, Context DB는 세션 **간** 영속 — 상보적으로 결합한다.

## 모델·effort 배정 원칙 (Opus 4.8 기준)

모델은 추론 깊이·비용으로, effort는 노력 수준(토큰 소비)으로 — 두 축을 조합해 배정한다.

| 모델 | 적합한 역할 | 이유 |
|------|------------|------|
| opus | 계획, 설계 검토, 코드 리뷰, 근본 원인 진단, long-horizon 구현 | 깊은 추론, 적응형 사고. 4.8의 long-context·도구 트리거 개선으로 장기 구현(ralph)에도 적합 |
| sonnet | 테스트 작성, 빌드/테스트 검증 | 도구 호출 빈도가 높거나 단순한 실행에 비용 효율적. effort로 노력 수준 제어 |

| effort | 적합한 역할 | 배정 에이전트 |
|--------|------------|--------------|
| high | 깊은 추론·판단, 장기 구현 (서브에이전트 최대 권장값) | planner, architect, reviewer, debugger, ralph |
| medium | 균형형 실행 | test-engineer |
| low | 단순 실행+판정 | verifier |

배정 판단 기준:
- **추론 깊이가 핵심**이면 opus — 하나의 정확한 판단이 중요한 역할
- **장기 구현·에이전틱**이면 opus + high — 4.8 long-horizon 개선의 수혜 (fewer compactions, better tool triggering)
- **도구 호출 빈도가 높거나 단순**하면 sonnet — effort로 비용을 조절
- **effort는 노력 수준 제어**: 분석·장기 구현 `high`, 균형 `medium`, 단순 판정 `low`
- ⚠️ **서브에이전트 frontmatter effort는 `low/medium/high/max`만 유효** — `xhigh`는 세션/API 레벨 값(ultracode 보고용)이라 서브에이전트 스코프에선 무시될 수 있다. 장기 구현도 `high`를 쓴다
- ⚠️ **haiku는 effort 파라미터 미지원** — 노력 제어가 필요하면 sonnet + low로 배정 (verifier가 이 경우)
- ⚠️ **토큰 부담 인지**: opus 다중 위임은 서브에이전트당 오버헤드 + 누적 비용이 크다. 한 번의 `/dotclaude-implement`가 주간 한도를 크게 소모할 수 있으니 — 소규모 작업은 수동 위임/직접 처리로, ralph 반복 상한(최대 10회)을 인지한다. 비용이 민감하면 planner/reviewer를 sonnet으로 내리는 것도 고려

## 에이전트 프롬프트 공통 원칙

모든 에이전트 프롬프트에 적용되는 원칙:
- **도구 사용 명시**: 도구가 필요한 상황을 구체적으로 지시한다 (예: "반드시 Read로 파일을 읽는다")
- **범위 한정**: 작업 범위를 명시적으로 한정한다. 범위 밖 작업을 자의적으로 확장하지 않는다
- **단일 접근 헌신**: 하나의 접근 방식을 선택한 뒤 끝까지 실행한다. 기존 판단과 직접 충돌하는 새 정보가 없는 한 결정을 재검토하지 않는다
- **병렬 팬아웃은 메인 세션 전용**: 독립 작업이 2개 이상이면 **메인 세션이** 단일 메시지에 여러 Agent를 동시 호출한다. ⚠️ 서브에이전트는 다른 서브에이전트를 생성할 수 없다(Agent/Task 도구가 서브에이전트 컨텍스트에서 제거됨) — 서브에이전트는 fan-out을 메인에 위임하거나 직접 순차 처리한다

## 모호한 요청 대응

요청이 모호한 경우 (대상 없는 추상적 동사, 파일/함수 미지정, 3개 이상 영역, 명확한 산출물 없음):
→ 탐색(Explore) → 계획(Plan) → 구현 순서로 진행.
