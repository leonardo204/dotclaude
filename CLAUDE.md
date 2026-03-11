# Claude Code 개발 가이드

> 공통 규칙(Agent Delegation, 커밋 정책, Context DB 등)은 글로벌 설정(`~/.claude/CLAUDE.md`)을 따릅니다.
> 글로벌 미설치 시: `curl -fsSL https://raw.githubusercontent.com/leonardo204/dotclaude/main/install.sh | bash`

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

- [Context DB 사용법](ref-docs/context-db.md)
- [Context Monitor (HUD)](ref-docs/context-monitor.md)
- [코딩 컨벤션](ref-docs/conventions.md)
- [셋업 가이드](ref-docs/setup.md)

### 핵심 규칙

- **global ↔ project-local 동기화 필수**: context-monitor.mjs 등 공유 파일 수정 시 양쪽 모두 반영. 한쪽만 수정하면 update 시 구버전 배포됨
- **글로벌 파일 수정 시 `~/.claude/`에도 복사**: `global/CLAUDE.md` → `~/.claude/CLAUDE.md`, `global/commands/` → `~/.claude/commands/`, `global/scripts/` → `~/.claude/scripts/`
- **Hook stdout 가시성 제약 준수**: `SessionStart`/`UserPromptSubmit`만 컨텍스트 주입 가능. `Stop`은 JSON 프로토콜(`{"decision":"block"}`)만 지원
- **init/update 명령은 repo clone 방식**: 파일 내용을 기억해서 작성 금지, 반드시 `project-local/`에서 복사

### 수정 체크리스트

파일 수정 시 아래 동기화 확인:

| 수정 대상 | 동기화 필요 |
|-----------|------------|
| `global/CLAUDE.md` | → `~/.claude/CLAUDE.md` |
| `global/commands/*.md` | → `~/.claude/commands/` |
| `global/scripts/context-monitor.mjs` | → `~/.claude/scripts/` + `project-local/scripts/` |
| `project-local/hooks/*.sh` | 이 프로젝트 `.claude/hooks/`에도 반영 |
| `project-local/scripts/context-monitor.mjs` | → `global/scripts/` + `~/.claude/scripts/` |
| `install.sh` | `global/` 디렉토리 구조와 복사 대상 일치 확인 |
| `uninstall.sh` | 삭제 대상 파일 목록이 `install.sh`가 설치하는 파일과 일치 확인 |
| `CLAUDE.md` (any) | → `README.md` 관련 섹션 업데이트 |

---

*최종 업데이트: 2026-03-11*
