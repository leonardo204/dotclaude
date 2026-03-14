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

### 개요

**dotclaude** — Claude Code 프로젝트 스타터 킷. 에이전트, 훅, DB, HUD를 한번에 세팅.

| 항목 | 값 |
|------|-----|
| Repo | https://github.com/leonardo204/dotclaude |
| 기술 스택 | Bash, SQLite, Node.js (HUD 스크립트) |
| 구조 | `install.sh` · `uninstall.sh` · `global/` (글로벌 설정) · `project-local/` (프로젝트 템플릿) · `ref-docs/` (참고 문서) |

### 상세 문서

- [Context DB](ref-docs/context-db.md) — SQLite 기반 세션/태스크/결정 저장소
- [Context Monitor](ref-docs/context-monitor.md) — HUD + compaction 감지/복구
- [Hooks](ref-docs/hooks.md) — 5개 자동 실행 Hook 상세
- [컨벤션](ref-docs/conventions.md) — 커밋, 주석, 로깅 규칙
- [셋업](ref-docs/setup.md) — 새 환경 초기 설정
- [Agent Delegation](ref-docs/agent-delegation.md) — 에이전트 위임/파이프라인 상세

### 핵심 규칙

- **global ↔ project-local 동기화 필수**: context-monitor.mjs 등 공유 파일 수정 시 양쪽 모두 반영. 한쪽만 수정하면 update 시 구버전 배포됨
- **글로벌 파일 수정 시 `~/.claude/`에도 복사**: `global/CLAUDE.md` → `~/.claude/CLAUDE.md`, `global/commands/` → `~/.claude/commands/`, `global/scripts/` → `~/.claude/scripts/`
- **Hook stdout 가시성 제약 준수**: `SessionStart`/`UserPromptSubmit`만 컨텍스트 주입 가능. `Stop`은 JSON 프로토콜(`{"decision":"block"}`)만 지원
- **init/update 명령은 repo clone 방식**: 파일 내용을 기억해서 작성 금지, 반드시 `project-local/`에서 복사
- **Mermaid 다이어그램 작성 시** → [컨벤션](ref-docs/conventions.md) 참조 (괄호 금지, 넘버링 규칙 등)

### 수정 체크리스트

파일 수정 시 아래 동기화 확인:

| 수정 대상 | 동기화 필요 |
|-----------|------------|
| `global/CLAUDE.md` | → `~/.claude/CLAUDE.md` |
| `global/commands/*.md` | → `~/.claude/commands/` |
| `global/scripts/context-monitor.mjs` | → `~/.claude/scripts/` + `project-local/scripts/` |
| `project-local/hooks/*.sh` | 이 프로젝트 `.claude/hooks/`에도 반영 |
| `project-local/scripts/context-monitor.mjs` | → `global/scripts/` + `~/.claude/scripts/` |
| `project-local/scripts/messenger.sh` | → `global/scripts/` + `.claude/scripts/` + `~/.claude/scripts/` |
| `install.sh` | `global/` 디렉토리 구조와 복사 대상 일치 확인 |
| `uninstall.sh` | 삭제 대상 파일 목록이 `install.sh`가 설치하는 파일과 일치 확인 |
| `CLAUDE.md` (any) | → `README.md` 관련 섹션 업데이트 |

---

*최종 업데이트: 2026-03-11*
