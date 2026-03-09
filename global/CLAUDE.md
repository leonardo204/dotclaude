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

Claude Code의 네이티브 `Agent` 도구로 복잡한 작업을 위임한다.

### 빌트인 에이전트

| subagent_type | 용도 | 사용 시점 |
|---------------|------|-----------|
| `Explore` | 코드베이스 탐색, 파일/패턴 검색 | 구조 파악, 키워드 검색, 아키텍처 이해 |
| `Plan` | 구현 전략 수립 | 빠른 계획 필요 시 |
| `general-purpose` | 범용 멀티스텝 작업 | 리서치, 복잡한 구현, 디버깅 |

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

### 구현 파이프라인 (`/project:implement`)

```
요청 → planner → 승인 → architect → 승인 → ralph + test-engineer → verifier → reviewer → 완료
```
- 계획/설계: 사용자 승인 루프
- 구현/검증/리뷰: 자동 실행, 실패 시 debugger 진단 → ralph 재진입

### 위임 판단 기준

| 상황 | 접근 방식 |
|------|-----------|
| 단일 파일 읽기/수정 | 직접 (Read, Edit) |
| 특정 클래스/함수 검색 | 직접 (Glob, Grep) |
| 3개 이상 파일 탐색 필요 | Agent (Explore) |
| 단순 구현 | 직접 또는 ralph |
| 복잡한 기능 (계획+설계+구현) | `/project:implement` 파이프라인 |
| 독립 작업 2개 이상 | Agent 병렬 실행 |

### 병렬 실행

- **병렬**: 독립적인 작업 2개 이상, 각각 30초 이상 소요 예상
- **순차**: 의존 관계가 있는 작업
- **백그라운드** (`run_in_background: true`): 빌드, 테스트, 설치 등 장시간 작업

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

### 새 프로젝트 (`/project-init`)
- `.claude/` 폴더가 없는 새 프로젝트에서 실행
- Context DB, Hooks, Commands, HUD 템플릿 자동 생성
- 이후 CLAUDE.md의 PROJECT 섹션을 프로젝트에 맞게 작성

### 기존 프로젝트 마이그레이션 (`/project-migration`)
- 이미 `.claude/`나 CLAUDE.md가 있는 프로젝트에서 실행
- 기존 설정 백업 후 시스템 구성요소 머지 (기존 hook/command 보존)
- CLAUDE.md를 COMMON + PROJECT 구조로 재구성 (상세 내용은 Ref-docs로 분리)

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
