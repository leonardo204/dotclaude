# Claude Code Global Development Guide

## Core Principles

- 한국어로 대화 (코드/커밋 제외)
- Documentation-First: 구현 전 공식 문서 확인. Context7 MCP: `resolve-library-id` → `query-docs`
- Verification: 완료 선언 전 검증 증거(빌드/테스트/타입체크) 필수
- Continuation: 미완료 태스크, 미통과 테스트, 에러가 있으면 계속 작업

---

## Agent Delegation

- 메인 컨텍스트는 판단 + 위임. 실행은 Agent에 맡긴다
- 필수 Agent: 파일 3개+, 멀티스텝 5+, 복잡한 구현, 코드베이스 탐색(Explore), 장시간 작업(background)
- 직접 처리: 단일 파일, 특정 검색, 즉답, 1-2단계 작업
- 커스텀 에이전트: `subagent_type: "general-purpose"` + 프롬프트에 `.claude/agents/<name>.md` Read
- 파이프라인: planner → architect → ralph + test-engineer → verifier → reviewer
- 파이프라인 자동 트리거: 새 기능+2파일 이상 / 아키텍처 변경 / "구현해줘"+구체적 명세

→ 상세: ref-docs/agent-delegation.md

---

## Context 저장

- 작업 시작: `live-set current_task "설명"`
- 핵심 발견: `live-set key_findings "내용"`
- 설계 결정: `decision-add "설명" "이유"`
- Hook 자동: working_files, error_context, session_summary
- `<remember>정보</remember>` (7일) / `<remember priority>정보</remember>` (영구)

→ 상세: ref-docs/context-db.md

---

## 커밋/푸시 정책

- 사용자의 명시적 요청 전까지 **절대 git add/commit/push 금지**
- 커밋 컨벤션: `[Feature]`, `[Fix]`, `[UI]`, `[Refactor]`, `[Docs]`

---

## Project Setup

- `/dotclaude-init`: 새 프로젝트 — .claude/ 환경 자동 생성
- `/dotclaude-update`: 기존 프로젝트 — 시스템 파일 최신 업데이트 (PROJECT 섹션 보존)

---

## 시스템 참조

- Context DB: `.claude/db/context.db` + `helper.sh` → ref-docs/context-db.md
- Context Monitor: compaction 대응 + HUD → ref-docs/context-monitor.md
- Hooks: 5개 자동 실행 스크립트 → ref-docs/hooks.md
- 컨벤션: 커밋, 주석, 로깅 → ref-docs/conventions.md
- 셋업: 새 환경 설정 → ref-docs/setup.md
- Messenger: Telegram 알림 → `~/.claude/scripts/messenger.sh`, `/dotclaude-messenger`

---

## Slim 정책

CLAUDE.md는 **100줄 이하**를 유지한다. 새 지침 추가 시:
1. 매 턴 참조 필요 → CLAUDE.md에 1줄 추가
2. 상세/예시/테이블 → ref-docs/*.md에 작성 후 참조
3. ref-docs 헤더 형식: `# 제목 — 한 줄 설명` (필요 문서 빠르게 식별용)
