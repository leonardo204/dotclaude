# Claude Code 개발 가이드

> 공통 규칙(Agent Delegation, 커밋 정책, Context DB 등)은 글로벌 설정(`~/.claude/CLAUDE.md`)을 따릅니다.
> 글로벌 미설치 시: `curl -fsSL https://raw.githubusercontent.com/leonardo204/dotclaude/main/install.sh | bash`

---

## Slim 정책

이 파일은 **100줄 이하**를 유지한다. 새 지침 추가 시:
1. 매 턴 참조 필요 → 이 파일에 1줄 추가
2. 상세/예시/테이블 → ref-docs/*.md에 작성 후 여기서 참조
3. ref-docs 헤더: `# 제목 — 한 줄 설명` (모델이 첫 줄만 보고 필요 여부 판단)

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

### 문서 구조 (소유권 분리)

- **하니스 문서** (`claude/` 하위) — 🔒 dotclaude 소유. `dotclaude-update`가 덮어쓰니 **수정 금지**.
- **프로젝트 스펙** (`specs/` 하위) — 📝 자유롭게 작성. → [SDD 가이드라인](ref-docs/sdd.md) · `/spec-guard`로 정합성 분석

### 하니스 상세 문서 (claude/)

- [Context DB](ref-docs/context-db.md) — SQLite 기반 세션/태스크/결정 저장소
- [Context Monitor](ref-docs/context-monitor.md) — HUD + compaction 감지/복구
- [Hooks](ref-docs/hooks.md) — 5개 자동 실행 Hook 상세
- [컨벤션](ref-docs/conventions.md) — 커밋, 주석, 로깅 규칙
- [셋업](ref-docs/setup.md) — 새 환경 초기 설정
- [Agent Delegation](ref-docs/agent-delegation.md) — 에이전트 위임/파이프라인 상세
- [SDD 가이드라인](ref-docs/sdd.md) — 스펙 문서 작성/관리 규약

> 프로젝트 스펙은 `specs/`에 작성하고, 하니스 문서(`claude/`)는 건드리지 마세요.

### 핵심 규칙

- (프로젝트 고유의 코딩 규칙, 금지 사항 등)

---

*최종 업데이트: YYYY-MM-DD*
