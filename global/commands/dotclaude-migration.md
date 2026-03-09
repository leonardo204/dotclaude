기존 프로젝트를 dotclaude 시스템으로 마이그레이션 / 시스템 파일 클린 재설치

## 핵심 원칙

- **모든 시스템 파일은 dotclaude 저장소에서 직접 복사한다. 절대 내용을 기억해서 작성하지 않는다.**
- **시스템 파일(hooks, commands, agents, db, scripts, settings)은 항상 repo 최신으로 클린 교체한다.**
- **CLAUDE.md의 PROJECT 섹션은 보존한다.**

## 실행 순서

### 1단계: 사전 확인

```bash
git rev-parse --show-toplevel
ls -la .claude/ 2>/dev/null
```

기존 상태를 사용자에게 간략 보고 후 진행 확인.

### 2단계: dotclaude 저장소 가져오기

```bash
DOTCLAUDE_TMP=$(mktemp -d)
git clone --depth 1 https://github.com/leonardo204/dotclaude.git "$DOTCLAUDE_TMP"
SRC="$DOTCLAUDE_TMP/project-local"
```

클론 실패 시 중단.

### 3단계: 시스템 파일 클린 설치

디렉토리 생성 후 시스템 파일을 repo에서 **무조건 덮어쓰기**:

```bash
mkdir -p .claude/agents .claude/db .claude/hooks .claude/commands .claude/scripts

# 에이전트 (7개) — 클린 교체
cp "$SRC"/agents/*.md .claude/agents/

# DB 스키마 + Helper CLI — 클린 교체 (context.db는 유지)
cp "$SRC"/db/init.sql .claude/db/
cp "$SRC"/db/helper.sh .claude/db/

# Hooks (6개) — 클린 교체
cp "$SRC"/hooks/*.sh .claude/hooks/
chmod +x .claude/hooks/*.sh

# Commands (5개) — 클린 교체
cp "$SRC"/commands/*.md .claude/commands/

# HUD 스크립트 — 클린 교체
cp "$SRC"/scripts/context-monitor.mjs .claude/scripts/

# settings.json — 클린 교체
cp "$SRC"/settings.json .claude/settings.json
```

**주의**: 프로젝트 고유 hooks/commands/agents (시스템 파일과 다른 이름)는 삭제되지 않음 (cp는 덮어쓰기만).

### 4단계: Context DB

DB 없으면 생성, 있으면 유지:

```bash
[ ! -f ".claude/db/context.db" ] && sqlite3 .claude/db/context.db < .claude/db/init.sql
```

### 5단계: CLAUDE.md 재구성

#### 기존 CLAUDE.md가 없는 경우

repo 템플릿을 그대로 복사:
```bash
cp "$SRC/CLAUDE.md" CLAUDE.md
```
사용자에게 PROJECT 섹션 작성 안내.

#### 기존 CLAUDE.md가 있는 경우

1. 기존 CLAUDE.md에서 **PROJECT 섹션 내용을 추출**하여 보존
2. repo 템플릿(`$SRC/CLAUDE.md`)의 **COMMON 섹션을 그대로 사용**
3. 보존한 PROJECT 섹션을 새 COMMON 아래에 결합

결과 구조:
```markdown
# Claude Code 개발 가이드

---

## COMMON

(repo 템플릿의 COMMON — 항상 최신)

---

## PROJECT

(기존 프로젝트 내용 보존)

---

*최종 업데이트: {오늘 날짜}*
```

초안을 사용자에게 보여주고 확인.

### 6단계: .gitignore 업데이트

```bash
grep -q 'context.db' .gitignore 2>/dev/null || echo -e '\n# Claude Code runtime\n.claude/db/context.db' >> .gitignore
grep -q '.ctx_state' .gitignore 2>/dev/null || echo '.claude/.ctx_state' >> .gitignore
grep -q '.backup-' .gitignore 2>/dev/null || echo '.claude/.backup-*' >> .gitignore
grep -q '.ralph_state' .gitignore 2>/dev/null || echo '.claude/.ralph_state' >> .gitignore
grep -q '.hud_cache' .gitignore 2>/dev/null || echo '.claude/.hud_cache' >> .gitignore
grep -q '.hook_feedback' .gitignore 2>/dev/null || echo '.claude/.hook_feedback' >> .gitignore
```

### 7단계: 정리

```bash
rm -rf "$DOTCLAUDE_TMP"
```

## 완료 메시지

```
## 마이그레이션 완료

설치 소스: https://github.com/leonardo204/dotclaude

클린 설치:
- .claude/agents/ (7개)
- .claude/hooks/ (6개)
- .claude/commands/ (5개)
- .claude/db/ (init.sql, helper.sh)
- .claude/scripts/ (context-monitor.mjs)
- .claude/settings.json
- CLAUDE.md (COMMON=최신, PROJECT=보존)

다음 단계:
1. CLAUDE.md PROJECT 섹션 확인
2. 다음 세션부터 자동 추적 시작
```

## 주의사항

- **파일 내용을 절대 기억해서 작성하지 않는다** — 반드시 repo에서 복사
- context.db는 유지 (기존 세션 데이터 보존)
- CLAUDE.md의 PROJECT 섹션은 반드시 보존
