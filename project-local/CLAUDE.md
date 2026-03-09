# Claude Code 개발 가이드

---

## COMMON

### 문서 관리 정책

- **CLAUDE.md는 slim하게 유지**: 항목당 1줄 이내. 길어지면 별도 문서로 분리 후 링크
- **별도 문서 위치**: 관련 문서가 있으면 거기에 추가, 없으면 `Ref-docs/claude/`에 신규 생성

### 언어 정책

- **모든 대화, 리포트, 설명은 한국어**로 진행 (코드/커밋 메시지 제외)

### 커밋/푸시 정책

- 사용자가 `/commit` 실행 또는 명시적 요청 전까지 **절대 git add/commit/push 금지**
- 커밋 컨벤션: `[Feature]`, `[Fix]`, `[UI]`, `[Refactor]`, `[Docs]` — 상세 → [컨벤션 문서](Ref-docs/claude/conventions.md)

### TODO-PLAN.md

- 위치: `archive/TODO-PLAN.md`
- 완료 항목은 즉시 **삭제** (체크가 아닌 삭제)
- 새 할 일 발견 시 추가 여부를 사용자에게 확인

### Context DB (SQLite)

- DB: `.claude/db/context.db` | Helper: `bash "$(git rev-parse --show-toplevel)/.claude/db/helper.sh" <command>`
- 주요 명령: `ctx-get/set`, `task-add/list/done`, `decision-add`, `error-log`, `live-set/get/dump`, `stats`
- 상세 → [Context DB 문서](Ref-docs/claude/context-db.md)

### Context Monitor (compaction 대응)

- `.claude/scripts/context-monitor.mjs` → 매 턴 ctx% 캡처 → `.claude/.ctx_state` 기록
- ctx >= 70% → hook이 "상태 저장" 리마인더 주입 | compaction 감지 → `live_context`에서 자동 복구
- 상세 → [Context Monitor 문서](Ref-docs/claude/context-monitor.md)

### Live Context 관리

- **매 턴 종료 시** `live-set`으로 아래 key 업데이트:
  - `current_task`, `working_files`, `key_findings`

### Agent Delegation

**메인 컨텍스트는 사용자 대화 + 판단 + 위임에 집중한다. 실행은 Agent에 맡긴다.**

#### 필수 트리거 — 이 조건에 해당하면 반드시 Agent 생성

| 트리거 조건 | Agent 유형 | 이유 |
|-------------|-----------|------|
| 파일 3개 이상 읽기/수정 필요 | `general-purpose` | 컨텍스트 보호 |
| 멀티스텝 실행 (5단계 이상) | `general-purpose` | 자율 실행이 효율적 |
| 복잡한 기능 구현 (아래 자동 감지) | 구현 파이프라인 | 다중 에이전트 협업 |
| `/dotclaude-init`, `/dotclaude-migration` | `general-purpose` | repo 클론+파일 복사+검증 |
| 코드베이스 구조 파악 | `Explore` | 탐색 특화 |
| 독립 작업 2개 이상 동시 | Agent 병렬 생성 | 처리량 극대화 |
| 빌드/테스트/설치 등 장시간 | Agent (`run_in_background`) | 블로킹 방지 |

#### 직접 처리 — Agent 불필요

| 상황 | 접근 |
|------|------|
| 단일 파일 읽기/수정 | Read, Edit |
| 특정 클래스/함수 검색 | Glob, Grep |
| 사용자 질문에 즉답 | 직접 응답 |
| 간단한 1-2단계 작업 | 직접 실행 |

#### 위임 패턴

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

| 에이전트 | 역할 | 수정 권한 |
|----------|------|:---------:|
| `planner` | 요청 분석 → 태스크 분해 + 수용 기준 정의 | ❌ |
| `architect` | 설계 검토 + 아키텍처 타당성 검증 | ❌ |
| `ralph` | 끈질긴 구현 — 완료될 때까지 반복 (빌드/테스트 통과 필수) | ✅ |
| `verifier` | 빌드/테스트/타입체크 증거 기반 검증 | ❌ |
| `reviewer` | 코드 리뷰 — 보안/정확성/품질 검토 | ❌ |
| `debugger` | 버그/에러 근본 원인 진단 (수정은 ralph) | ❌ |
| `test-engineer` | 테스트 전략 수립 + 테스트 코드 작성 | ✅ |

### 구현 파이프라인

```
요청 → [planner] → 승인 → [architect] → 승인 → [ralph + test-engineer] → [verifier] → [reviewer] → 정리 → 사용자 확인
         ↑ 수정 반복    ↑ 수정 반복       ↑ 실패 시 [debugger] 진단 → ralph 재진입 ←──────┘
```

- Phase 1-2 (계획/설계): 사용자 승인 필수
- Phase 3-5 (구현/검증/리뷰): 자동 실행, 실패 시 debugger 진단 → Ralph 수정 후 재검증
- 버그 발생 시: `debugger` 진단 → `ralph` 수정 (직접 사용 가능)
- 강제 중단: "중단" 요청 시 즉시 중단 + 현재 상태 보고

**자동 트리거 조건** — `/project:implement` 명시 실행뿐 아니라, 아래 조건 감지 시 자동으로 파이프라인을 제안하거나 실행:

| 감지 패턴 | 예시 | 동작 |
|-----------|------|------|
| 새 기능 구현 요청 + 2개 이상 파일 수정 예상 | "로그인 기능 추가해줘" | 파이프라인 제안 → 승인 시 실행 |
| 아키텍처 변경이 수반되는 요청 | "인증을 JWT에서 세션으로 바꿔줘" | 파이프라인 제안 |
| "구현해줘", "만들어줘" + 구체적 기능 명세 | "댓글 시스템 구현해줘" | 파이프라인 제안 |
| 단순 수정/버그픽스 | "이 에러 고쳐줘", "버튼 색상 변경" | 직접 처리 또는 ralph 단독 |

**판단 기준**: 계획+설계가 필요한 규모인가? → Yes면 파이프라인, No면 직접/ralph

### 커스텀 명령어

| 명령어 | 설명 |
|--------|------|
| `/project:implement` | 전체 파이프라인 실행 (계획→설계→구현→검증→리뷰) |
| `/project:commit` | 문서 업데이트 + 기능별 커밋 + 푸시 |
| `/project:tellme` | 최근 작업 브리핑 + 다음 할 일 제안 |
| `/project:discover` | DB 패턴 분석 → 자동화 제안 |
| `/project:reportdb` | Context DB 전체 현황 리포트 |

### Setup (다른 PC에서 클론 후)

- `~/.claude/settings.json`에 statusline 추가 → [Setup 상세](Ref-docs/claude/setup.md)
- DB는 첫 세션에서 자동 생성 | 필요 도구: `sqlite3` (OS 내장), `node`

---

## PROJECT

> 아래 섹션을 프로젝트에 맞게 작성하세요.

### 개요

**프로젝트명** — 한 줄 설명

| 항목 | 값 |
|------|-----|
| 기술 스택 | (예: iOS 17+, SwiftUI, SwiftData) |
| 빌드 방법 | (예: `cd src && xcodegen generate`) |
| 상태 | (예: 개발 중 / 출시) |

### 상세 문서

(프로젝트 관련 문서 링크)

### 핵심 규칙

- (프로젝트 고유의 코딩 규칙, 금지 사항 등)

---

*최종 업데이트: YYYY-MM-DD*
