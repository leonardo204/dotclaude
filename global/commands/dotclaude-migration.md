기존 프로젝트를 dotclaude 시스템으로 마이그레이션 (.claude/ 구조 전환)

## 핵심 원칙

**모든 시스템 파일은 dotclaude 저장소에서 직접 복사한다. 절대 내용을 기억해서 작성하지 않는다.**
**기존 프로젝트 고유 파일(hooks, commands, agents)은 절대 삭제하지 않는다.**

## 사전 확인

1. 현재 디렉토리가 git 프로젝트 루트인지 확인:
   ```bash
   git rev-parse --show-toplevel
   ```

2. 기존 상태 파악:
   ```bash
   ls -la .claude/ 2>/dev/null
   cat .claude/settings.json 2>/dev/null
   ls .claude/hooks/ 2>/dev/null
   ls .claude/commands/ 2>/dev/null
   ls .claude/agents/ 2>/dev/null
   head -20 CLAUDE.md 2>/dev/null
   ```

3. 사용자에게 현황 보고 후 진행 확인:
   ```
   ## 마이그레이션 현황
   - CLAUDE.md: 있음/없음 (N줄)
   - .claude/settings.json: 있음/없음
   - .claude/hooks/: N개 파일 (목록)
   - .claude/commands/: N개 파일 (목록)
   - .claude/agents/: N개 파일 (목록)
   - .claude/db/: 있음/없음

   계속 진행할까요?
   ```

## 실행 순서

### 1단계: dotclaude 저장소 가져오기

```bash
DOTCLAUDE_TMP=$(mktemp -d)
git clone --depth 1 https://github.com/leonardo204/dotclaude.git "$DOTCLAUDE_TMP"
SRC="$DOTCLAUDE_TMP/project-local"
```

클론 실패 시 사용자에게 안내하고 중단.

### 2단계: 기존 설정 백업

```bash
BACKUP_DIR=".claude/.backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

[ -f "CLAUDE.md" ] && cp CLAUDE.md "$BACKUP_DIR/CLAUDE.md"
[ -f ".claude/settings.json" ] && cp .claude/settings.json "$BACKUP_DIR/settings.json"
[ -d ".claude/hooks" ] && cp -r .claude/hooks "$BACKUP_DIR/hooks"
[ -d ".claude/commands" ] && cp -r .claude/commands "$BACKUP_DIR/commands"
[ -d ".claude/agents" ] && cp -r .claude/agents "$BACKUP_DIR/agents"
```

사용자에게 백업 경로 안내.

### 3단계: 디렉토리 구조 보장

```bash
mkdir -p .claude/agents .claude/db .claude/hooks .claude/commands .claude/scripts
```

### 4단계: 에이전트 설치 (머지)

시스템 에이전트 7개를 repo에서 복사:

```bash
for agent in ralph planner architect verifier reviewer debugger test-engineer; do
    cp "$SRC/agents/${agent}.md" ".claude/agents/${agent}.md"
done
```

**기존 프로젝트 고유 에이전트** (위 7개 외)는 그대로 보존.
이름 충돌 시 사용자에게 확인: "기존 {name}.md를 시스템 버전으로 교체할까요?"

### 5단계: Context DB 설치

```bash
# init.sql, helper.sh는 항상 최신으로 교체
cp "$SRC"/db/init.sql .claude/db/
cp "$SRC"/db/helper.sh .claude/db/

# DB는 없을 때만 생성
if [ ! -f ".claude/db/context.db" ]; then
    sqlite3 .claude/db/context.db < .claude/db/init.sql
fi
```

### 6단계: Hooks 머지

시스템 hooks 6개를 **repo에서 직접 복사**:

```bash
for hook in session-start on-prompt post-tool-edit post-tool-bash on-stop ralph-persist; do
    cp "$SRC/hooks/${hook}.sh" ".claude/hooks/${hook}.sh"
done
chmod +x .claude/hooks/*.sh
```

**기존 프로젝트 고유 hooks** (위 6개 외)는 그대로 보존.
이름 충돌하는 시스템 hook은 repo 버전으로 교체 (백업은 이미 2단계에서 완료).

### 7단계: settings.json 머지

**기존 settings.json이 없는 경우:**
```bash
cp "$SRC/settings.json" .claude/settings.json
```

**기존 settings.json이 있는 경우:**
기존 JSON을 읽고, 시스템 hook 설정을 머지한다.

머지 규칙:
1. `$SRC/settings.json`의 hooks 구조를 기준으로 한다
2. 기존 settings.json에 시스템 hook event가 없으면 추가
3. 기존 settings.json에 시스템 hook event가 있으면:
   - 시스템 hook의 command 경로와 동일한 항목이 있으면 교체
   - 프로젝트 고유 hook 항목은 보존
4. hooks 외의 기존 설정 (statusLine, enabledPlugins 등)은 그대로 보존

**중요**: 기존 hook 설정이 삭제되지 않도록 반드시 머지 방식으로 처리.

### 8단계: HUD / Context Monitor 설치

```bash
cp "$SRC"/scripts/context-monitor.mjs .claude/scripts/
```

사용자에게 HUD 설치 위치 확인 (init과 동일 옵션 A/B/C).

### 9단계: Commands 머지

시스템 commands 5개를 repo에서 복사:

```bash
for cmd in implement commit tellme discover reportdb; do
    cp "$SRC/commands/${cmd}.md" ".claude/commands/${cmd}.md"
done
```

**기존 프로젝트 고유 commands** (위 5개 외)는 그대로 보존.

### 10단계: CLAUDE.md 재구성 (핵심)

#### 10-1. 기존 CLAUDE.md 분석

기존 CLAUDE.md 전체를 읽고 내용을 분류:

| 카테고리 | 처리 |
|----------|------|
| 언어/커밋 정책 | COMMON에 포함 → 중복 제거 |
| DB/Hook/Monitor 관련 | COMMON에 포함 → 중복 제거 |
| 프로젝트 개요 | → PROJECT "개요" |
| 아키텍처/구조 | → 3줄 요약 + 상세 문서 링크 |
| 코딩 규칙 | → PROJECT "핵심 규칙" (항목당 1줄) |
| 작업 히스토리 | → 별도 문서로 분리 또는 삭제 |

#### 10-2. 새 CLAUDE.md 작성

**COMMON 섹션은 repo 템플릿(`$SRC/CLAUDE.md`)의 COMMON을 그대로 사용한다.**
PROJECT 섹션만 기존 내용을 정리해서 채운다.

```bash
# COMMON 섹션 추출
sed -n '/^## COMMON/,/^## PROJECT/p' "$SRC/CLAUDE.md" | head -n -1 > /tmp/common_section.md
```

새 CLAUDE.md 구조:
```markdown
# Claude Code 개발 가이드

---

## COMMON

(repo 템플릿의 COMMON 그대로 — 문서 관리, 언어, 커밋, DB, Monitor, Live Context, 에이전트, 파이프라인, 명령어, Setup)

---

## PROJECT

### 개요
(기존 내용에서 추출)

### 상세 문서
(기존 문서 링크 정리)

### 핵심 규칙
(프로젝트 고유 규칙, 항목당 1줄)

---

*최종 업데이트: {오늘 날짜}*
```

#### 10-3. 사용자 검토

새 CLAUDE.md 초안을 사용자에게 보여주고 확인:
- "기존 내용 중 누락된 것이 있나요?"
- "PROJECT 섹션의 요약이 적절한가요?"

### 11단계: .gitignore 업데이트

```bash
grep -q 'context.db' .gitignore 2>/dev/null || echo -e '\n# Claude Code runtime\n.claude/db/context.db' >> .gitignore
grep -q '.ctx_state' .gitignore 2>/dev/null || echo '.claude/.ctx_state' >> .gitignore
grep -q '.backup-' .gitignore 2>/dev/null || echo '.claude/.backup-*' >> .gitignore
grep -q '.ralph_state' .gitignore 2>/dev/null || echo '.claude/.ralph_state' >> .gitignore
grep -q '.hud_cache' .gitignore 2>/dev/null || echo '.claude/.hud_cache' >> .gitignore
grep -q '.hook_feedback' .gitignore 2>/dev/null || echo '.claude/.hook_feedback' >> .gitignore
```

### 12단계: 정리

```bash
rm -rf "$DOTCLAUDE_TMP"
```

## 완료 메시지

```
## 마이그레이션 완료

설치 소스: https://github.com/leonardo204/dotclaude

### 백업
- 기존 설정: {$BACKUP_DIR}/

### 설치/업데이트
- .claude/agents/ (7개 시스템 에이전트)
- .claude/db/ (Context DB + Helper CLI)
- .claude/hooks/ (6개 시스템 hook)
- .claude/commands/ (5개 시스템 command)
- .claude/scripts/ (HUD statusline)
- .claude/settings.json (Hook 등록)

### 전환됨
- CLAUDE.md → COMMON + PROJECT 구조로 재구성

### 보존됨
- 기존 프로젝트 고유 hooks: {목록}
- 기존 프로젝트 고유 commands: {목록}
- 기존 프로젝트 고유 agents: {목록}

### 다음 단계
1. CLAUDE.md의 PROJECT 섹션 검토 및 보완
2. 다음 세션부터 자동 추적 시작
```

## 주의사항

- **파일 내용을 절대 기억해서 작성하지 않는다** — 반드시 repo에서 복사
- **절대 기존 파일을 백업 없이 삭제/덮어쓰기 하지 않는다**
- settings.json은 항상 머지 (기존 설정 보존)
- 기존 프로젝트 고유 hooks/commands/agents는 절대 삭제하지 않는다
- CLAUDE.md 재구성 시 COMMON은 repo 템플릿 그대로 사용
- 마이그레이션 후 기존 백업은 사용자가 직접 삭제 (자동 삭제 금지)
