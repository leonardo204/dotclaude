# Claude Code Global Development Guide

## Core Principles

### 언어 정책

- **모든 대화, 리포트, 설명은 한국어**로 진행 (코드/커밋 메시지 제외)

### Documentation-First

SDK/API/프레임워크 구현 전 공식 문서를 먼저 확인한다.
Context7 MCP 사용 가능 시: `resolve-library-id` → `query-docs` 순서로 최신 문서 조회.
필드명, API 계약을 추측하지 않는다.

### Verification (Iron Law)

**완료 선언 전 반드시 검증 증거를 확보한다.**

1. 완료를 증명할 수 있는 것이 무엇인지 파악
2. 검증 실행 (테스트, 빌드, 타입체크 등)
3. 출력 확인
4. 증거와 함께 완료 선언

### Continuation Enforcement

작업 종료 전 확인: 미완료 태스크 0, 기능 정상 동작, 테스트 통과, 에러 0.
**하나라도 미확인이면 계속 작업한다.**

---

## Agent Delegation

**메인 컨텍스트는 사용자 대화 + 판단 + 위임에 집중한다. 실행은 Agent에 맡긴다.**

### 필수 트리거 — 이 조건에 해당하면 반드시 Agent 생성

| 트리거 조건 | Agent 유형 | 이유 |
|-------------|-----------|------|
| 파일 3개 이상 읽기/수정 필요 | `general-purpose` | 컨텍스트 보호 |
| 멀티스텝 실행 (5단계 이상) | `general-purpose` | 자율 실행이 효율적 |
| 복잡한 기능 구현 (아래 자동 감지) | 구현 파이프라인 | 다중 에이전트 협업 |
| `/dotclaude-init`, `/dotclaude-update` | `general-purpose` | repo 클론+파일 복사+검증 |
| 코드베이스 구조 파악 | `Explore` | 탐색 특화 |
| 독립 작업 2개 이상 동시 | Agent 병렬 생성 | 처리량 극대화 |
| 빌드/테스트/설치 등 장시간 | Agent (`run_in_background`) | 블로킹 방지 |

### 직접 처리 — Agent 불필요

| 상황 | 접근 |
|------|------|
| 단일 파일 읽기/수정 | Read, Edit |
| 특정 클래스/함수 검색 | Glob, Grep |
| 사용자 질문에 즉답 | 직접 응답 |
| 간단한 1-2단계 작업 | 직접 실행 |

### 위임 패턴

**사용자 확인이 필요한 멀티스텝 작업:**
```
메인: 분석/리포트 → 사용자 확인
사용자: "진행해"
메인: Agent 생성 → 절차 위임 → 결과 수신 → 요약 보고
```

**병렬 실행:**
- 독립 작업 2개 이상 → 단일 메시지에 Agent 도구 여러 개 호출
- 의존 관계 있으면 → 순차 실행

### 커스텀 에이전트 (`.claude/agents/`)

| subagent_type | 역할 | 수정 권한 |
|---------------|------|:---------:|
| `planner` | 요청 분석 → 태스크 분해 + 수용 기준 정의 | ❌ |
| `architect` | 설계/구현 검토 + 아키텍처 타당성 검증 | ❌ |
| `ralph` | 끈질긴 구현 — 완료+검증될 때까지 절대 중단 안 함 | ✅ |
| `verifier` | 빌드/테스트/타입체크 증거 기반 검증 | ❌ |
| `reviewer` | 코드 리뷰 — 보안/정확성/품질 | ❌ |
| `debugger` | 버그/에러 근본 원인 진단 | ❌ |
| `test-engineer` | 테스트 전략 수립 + 테스트 코드 작성 | ✅ |

### 구현 파이프라인

```
요청 → planner → 승인 → architect → 승인 → ralph + test-engineer → verifier → reviewer → 완료
```
- 계획/설계: 사용자 승인 루프
- 구현/검증/리뷰: 자동 실행, 실패 시 debugger 진단 → ralph 재진입

**자동 트리거 조건** — `/project:dotclaude-implement` 명시 실행뿐 아니라, 아래 조건 감지 시 자동으로 파이프라인을 제안하거나 실행:

| 감지 패턴 | 예시 | 동작 |
|-----------|------|------|
| 새 기능 구현 요청 + 2개 이상 파일 수정 예상 | "로그인 기능 추가해줘" | 파이프라인 제안 → 승인 시 실행 |
| 아키텍처 변경이 수반되는 요청 | "인증을 JWT에서 세션으로 바꿔줘" | 파이프라인 제안 |
| "구현해줘", "만들어줘" + 구체적 기능 명세 | "댓글 시스템 구현해줘" | 파이프라인 제안 |
| 단순 수정/버그픽스 | "이 에러 고쳐줘", "버튼 색상 변경" | 직접 처리 또는 ralph 단독 |

**판단 기준**: 계획+설계가 필요한 규모인가? → Yes면 파이프라인, No면 직접/ralph

---

## Broad Request Detection

요청이 **모호한 경우**: 대상 없는 추상적 동사, 특정 파일/함수 미지정, 3개 이상 영역에 걸침, 명확한 산출물 없는 한 문장.

**대응**: 탐색(Explore) → 계획(Plan) → 구현 순서로 진행.

---

## Context Persistence

`<remember>` 태그로 세션 간 정보 보존:
- `<remember>정보</remember>` — 7일 유지
- `<remember priority>정보</remember>` — 영구 유지

---

## 커밋/푸시 정책

- 사용자의 명시적 요청 전까지 **절대 git add/commit/push 금지**
- 커밋 컨벤션: `[Feature]`, `[Fix]`, `[UI]`, `[Refactor]`, `[Docs]`

---

## Project Setup

### 새 프로젝트 (`/dotclaude-init`)
- `.claude/` 폴더가 없는 새 프로젝트에서 실행
- Context DB, Hooks, Commands, HUD 템플릿 자동 생성
- 이후 CLAUDE.md의 PROJECT 섹션을 프로젝트에 맞게 작성

### 기존 프로젝트 업데이트 (`/dotclaude-update`)
- 이미 `.claude/`나 CLAUDE.md가 있는 프로젝트에서 실행
- 충돌 영향 분석 후 시스템 파일을 최신으로 클린 교체 (프로젝트 고유 파일 보존)
- CLAUDE.md의 PROJECT 섹션 보존

---

## 프로젝트 공통 시스템

### Context DB (SQLite)

프로젝트별 `.claude/db/context.db`로 세션 간 작업 추적.

- Helper: `bash .claude/db/helper.sh <command>`
- 주요 명령: `ctx-get/set`, `task-add/list/done`, `decision-add`, `error-log`, `live-set/get/dump`, `stats`
- 세션 시작 시 Hook이 자동으로 DB 초기화 + 세션 기록

### Context Monitor (compaction 대응)

- `.claude/scripts/context-monitor.mjs` → 매 턴 컨텍스트 사용률 캡처
- ctx >= 70% → "상태 저장" 리마인더 주입
- compaction 감지 → `live_context` 테이블에서 자동 복구

### Live Context 관리

매 턴 종료 시 `live-set`으로 핵심 상태 업데이트:
- `current_task`, `working_files`, `key_findings`

### Hooks (자동 실행)

| Hook | 시점 | 역할 |
|------|------|------|
| session-start.sh | 세션 시작 | DB 초기화, 세션 기록, 미완료 태스크 표시 |
| on-prompt.sh | 매 턴 | 컨텍스트 주입, compaction 복구 |
| post-tool-edit.sh | 파일 편집 후 | 편집 파일 로깅 |
| post-tool-bash.sh | Bash 실행 후 | 에러 자동 감지/로깅 |
| on-stop.sh | 세션 종료 | 세션 통계 업데이트 |
