dotclaude 시스템 파일을 최신 버전으로 업데이트 / 시스템 파일 클린 재설치

## 핵심 원칙

- **모든 시스템 파일은 dotclaude 저장소에서 직접 복사한다. 절대 내용을 기억해서 작성하지 않는다.**
- **시스템 파일은 항상 repo 최신으로 클린 교체한다.**
- **교체 전 반드시 충돌 영향 분석을 수행하고 사용자 확인을 받는다.**
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

### 3단계: 충돌 영향 분석

클린 설치 전에 기존 프로젝트 파일과의 충돌을 분석하여 사용자에게 리포트한다.

#### 3-1. 커스터마이징 감지

시스템 파일과 동일 이름이지만 내용이 변경된 파일을 찾는다:

```bash
# 시스템 에이전트 중 프로젝트에서 커스터마이징한 것
for f in "$SRC"/agents/*.md; do
    name=$(basename "$f")
    if [ -f ".claude/agents/$name" ]; then
        if ! diff -q "$f" ".claude/agents/$name" >/dev/null 2>&1; then
            echo "[변경됨] agents/$name"
        fi
    fi
done

# 시스템 dist/ 파일 중 프로젝트에서 커스터마이징한 것
for f in "$SRC"/dist/hooks/* "$SRC"/dist/hud/* "$SRC"/dist/mcp/*; do
    [ -f "$f" ] || continue
    rel="${f#$SRC/}"
    if [ -f ".claude/$rel" ]; then
        if ! diff -q "$f" ".claude/$rel" >/dev/null 2>&1; then
            echo "[변경됨] $rel"
        fi
    fi
done

# 시스템 command 중 프로젝트에서 커스터마이징한 것
for f in "$SRC"/commands/*.md; do
    name=$(basename "$f")
    if [ -f ".claude/commands/$name" ]; then
        if ! diff -q "$f" ".claude/commands/$name" >/dev/null 2>&1; then
            echo "[변경됨] commands/$name"
        fi
    fi
done
```

#### 3-2. 프로젝트 고유 파일 식별

시스템 파일이 아닌 프로젝트 고유 파일을 식별한다:

```bash
# 시스템 에이전트 이름 목록
SYS_AGENTS="ralph planner architect verifier reviewer debugger test-engineer"
for f in .claude/agents/*.md; do
    name=$(basename "$f" .md)
    if ! echo "$SYS_AGENTS" | grep -qw "$name"; then
        echo "[프로젝트 고유] agents/$name.md"
    fi
done

# 시스템 command 이름 목록
SYS_CMDS="dotclaude-implement dotclaude-commit dotclaude-tellme dotclaude-discover dotclaude-reportdb dotclaude-messenger dotclaude-help dotclaude-statusline"
for f in .claude/commands/*.md; do
    name=$(basename "$f" .md)
    if ! echo "$SYS_CMDS" | grep -qw "$name"; then
        echo "[프로젝트 고유] commands/$name.md"
    fi
done
```

#### 3-3. CLAUDE.md 변경 감지

기존 CLAUDE.md가 있는지, 시스템 템플릿과 다른지 확인:

```bash
if [ -f "CLAUDE.md" ]; then
    # PROJECT 섹션 추출 (## PROJECT ~ 다음 --- 또는 파일 끝)
    PROJECT_CONTENT=$(sed -n '/^## PROJECT/,/^---/{/^---$/!p}' CLAUDE.md)
    if [ -n "$PROJECT_CONTENT" ]; then
        echo "[CLAUDE.md] PROJECT 섹션 있음 — 보존 후 시스템 부분 재구성"
    else
        echo "[CLAUDE.md] PROJECT 섹션 없음 — 전체 교체"
    fi
else
    echo "[CLAUDE.md] 없음 — 새로 생성"
fi
```

#### 3-4. settings.json 충돌 분석

기존 settings.json에 프로젝트 고유 설정이 있는지 확인:

```bash
# 기존 settings.json의 키 목록
cat .claude/settings.json 2>/dev/null
# 시스템 settings.json의 키 목록
cat "$SRC/settings.json"
```

비교 항목:
- **hooks 외 설정** (statusLine, enabledPlugins, permissions 등): 교체 시 유실됨
- **프로젝트 고유 hook 등록**: 시스템 settings.json에 없는 hook event나 matcher

#### 3-5. 사용자에게 영향 리포트

```
## 충돌 영향 분석

### 커스터마이징된 시스템 파일 (교체 시 변경사항 유실)
- agents/reviewer.md — 프로젝트 맞춤 리뷰 기준 포함
- dist/hooks/bridge.js — 커스텀 훅 로직 추가
(없으면: "커스터마이징 없음 ✅")

### 프로젝트 고유 파일 (영향 없음 — 보존됨)
- agents/data-analyst.md
- commands/deploy.md
(없으면: "프로젝트 고유 파일 없음")

### CLAUDE.md
- PROJECT 섹션 보존 후 시스템 부분 재구성
(없으면: "새로 생성")

### settings.json 프로젝트 고유 설정 (교체 시 유실)
- enabledPlugins: {...}
- statusLine: {...}
(없으면: "프로젝트 고유 설정 없음 ✅")

### 권장 조치
- [자동] 프로젝트 고유 파일은 그대로 보존됩니다
- [자동] CLAUDE.md의 PROJECT 섹션은 보존됩니다
- [확인 필요] 커스터마이징된 시스템 파일 N개가 repo 버전으로 교체됩니다
- [확인 필요] settings.json의 프로젝트 고유 설정을 머지해야 합니다

진행할까요? (Y: 전체 진행 / N: 중단)
```

### 4단계: 시스템 파일 클린 설치

사용자 승인 후 실행.

```bash
mkdir -p .claude/agents .claude/db .claude/dist/hooks .claude/dist/hud .claude/dist/mcp .claude/commands

# 에이전트 — 클린 교체
cp "$SRC"/agents/*.md .claude/agents/

# DB 스키마 + Helper CLI — 클린 교체 (context.db는 유지)
cp "$SRC"/db/init.sql .claude/db/
cp "$SRC"/db/helper.sh .claude/db/

# dist/ — bridge (hooks), HUD, MCP 서버 — 클린 교체
cp -r "$SRC"/dist/hooks/* .claude/dist/hooks/
cp -r "$SRC"/dist/hud/* .claude/dist/hud/
cp -r "$SRC"/dist/mcp/* .claude/dist/mcp/

# Commands — 클린 교체
cp "$SRC"/commands/*.md .claude/commands/

# Scripts — messenger 등
mkdir -p .claude/scripts
cp "$SRC"/scripts/*.sh .claude/scripts/
cp "$SRC"/scripts/*.mjs .claude/scripts/ 2>/dev/null || true
chmod +x .claude/scripts/*.sh 2>/dev/null || true

# .mcp.json — MCP 서버 자동 시작 설정 (클린 교체)
cp "$SRC"/.mcp.json .mcp.json
```

### 4-b단계: 글로벌 파일 동기화

프로젝트 로컬뿐 아니라 `~/.claude/`의 글로벌 파일도 최신으로 업데이트한다.
Hook이 글로벌 경로(`~/.claude/scripts/`)를 참조하므로, 이 단계를 누락하면 구버전 스크립트가 실행된다.

```bash
GLOBAL_SRC="$DOTCLAUDE_TMP/global"

# 글로벌 scripts — messenger.sh, context-monitor.mjs 등
mkdir -p ~/.claude/scripts
cp "$GLOBAL_SRC"/scripts/*.sh ~/.claude/scripts/
cp "$GLOBAL_SRC"/scripts/*.mjs ~/.claude/scripts/ 2>/dev/null || true
chmod +x ~/.claude/scripts/*.sh 2>/dev/null || true

# 글로벌 commands — dotclaude-init, dotclaude-update 등
mkdir -p ~/.claude/commands
cp "$GLOBAL_SRC"/commands/*.md ~/.claude/commands/

# 글로벌 CLAUDE.md
cp "$GLOBAL_SRC"/CLAUDE.md ~/.claude/CLAUDE.md
```

### 5단계: settings.json 처리

#### 프로젝트 고유 설정이 없는 경우

```bash
cp "$SRC"/settings.json .claude/settings.json
```

#### 프로젝트 고유 설정이 있는 경우

시스템 settings.json을 기반으로 프로젝트 고유 설정을 머지:

1. `$SRC/settings.json`을 베이스로 사용 (hooks 설정 = 최신)
2. 기존 settings.json에서 hooks 외 프로젝트 고유 키(enabledPlugins, permissions 등)를 추출
3. 베이스에 프로젝트 고유 키를 추가
4. 기존 settings.json에 프로젝트 고유 hook 등록이 있으면 시스템 hooks 배열에 append

### 6단계: Context DB

DB 없으면 생성, 있으면 유지:

```bash
[ ! -f ".claude/db/context.db" ] && sqlite3 .claude/db/context.db < .claude/db/init.sql
```

### 7단계: 문서 폴더 감지 + ref-docs 복사

프로젝트의 기존 문서 폴더를 감지하여 ref-docs를 적절한 위치에 복사한다.

#### 7-1. 문서 폴더 감지

프로젝트 루트에서 일반적인 문서 폴더 패턴을 탐색:

```bash
DOC_DIRS=""
for d in docs documentation Ref-docs doc wiki; do
    [ -d "$d" ] && DOC_DIRS="$DOC_DIRS $d"
done
```

#### 7-2. 사용자 확인 및 경로 결정

감지 결과에 따라 분기:

**여러 개 발견 시:**
```
문서 폴더가 여러 개 발견되었습니다:
1. docs/
2. Ref-docs/

ref-docs 파일을 복사할 폴더를 선택하세요 (번호):
```
사용자가 선택한 폴더를 `$DOC_ROOT`로 설정.

**하나만 발견 시:**
```
기존 문서 폴더를 발견했습니다: docs/
이 폴더에 ref-docs를 복사할까요? (Y/N)
- Y: docs/claude/ 에 복사
- N: Ref-docs/claude/ 에 새로 생성
```

**없으면:**
```
기존 문서 폴더가 없습니다. Ref-docs/claude/에 생성합니다.
```
`$DOC_ROOT`를 `Ref-docs`로 설정.

#### 7-3. ref-docs 파일 복사

dotclaude repo의 `ref-docs/` 에서 감지된 문서 폴더의 `claude/` 서브폴더로 복사:

```bash
DOC_ROOT="{감지/선택된 폴더}"  # 예: docs, Ref-docs 등
mkdir -p "$DOC_ROOT/claude"
cp "$DOTCLAUDE_TMP/ref-docs/context-db.md" "$DOC_ROOT/claude/"
cp "$DOTCLAUDE_TMP/ref-docs/context-monitor.md" "$DOC_ROOT/claude/"
cp "$DOTCLAUDE_TMP/ref-docs/conventions.md" "$DOC_ROOT/claude/"
cp "$DOTCLAUDE_TMP/ref-docs/setup.md" "$DOC_ROOT/claude/"
```

### 8단계: CLAUDE.md 재구성

#### 기존 CLAUDE.md가 없는 경우

repo 템플릿을 그대로 복사:
```bash
cp "$SRC/CLAUDE.md" CLAUDE.md
```
사용자에게 PROJECT 섹션 작성 안내.

#### 기존 CLAUDE.md가 있는 경우

1. 기존 CLAUDE.md에서 **PROJECT 섹션 내용을 추출**하여 보존
2. repo 템플릿(`$SRC/CLAUDE.md`)을 기반으로 사용 (글로벌 참조 안내 + PROJECT 구조)
3. 보존한 PROJECT 섹션을 템플릿의 PROJECT 위치에 삽입

결과 구조:
```markdown
# Claude Code 개발 가이드

> 공통 규칙(Agent Delegation, 커밋 정책, Context DB 등)은 글로벌 설정(`~/.claude/CLAUDE.md`)을 따릅니다.
> 글로벌 미설치 시: `curl -fsSL https://raw.githubusercontent.com/leonardo204/dotclaude/main/install.sh | bash`

---

## PROJECT

(기존 프로젝트 내용 보존)

---

*최종 업데이트: {오늘 날짜}*
```

**주의**: COMMON 섹션은 포함하지 않는다. 공통 규칙은 글로벌 CLAUDE.md(`~/.claude/CLAUDE.md`)에서 자동 로드된다.

초안을 사용자에게 보여주고 확인.

#### CLAUDE.md 경로 치환

`$DOC_ROOT`가 `Ref-docs`가 아닌 경우, CLAUDE.md 내의 ref-docs 경로를 치환:

```bash
if [ "$DOC_ROOT" != "Ref-docs" ]; then
    sed -i '' "s|Ref-docs/claude/|${DOC_ROOT}/claude/|g" CLAUDE.md
fi
```

이렇게 하면 CLAUDE.md 내의 모든 참조 경로가 실제 문서 위치와 일치하게 된다:
- `Ref-docs/claude/conventions.md` → `{DOC_ROOT}/claude/conventions.md`
- `Ref-docs/claude/context-db.md` → `{DOC_ROOT}/claude/context-db.md`
- `Ref-docs/claude/context-monitor.md` → `{DOC_ROOT}/claude/context-monitor.md`
- `Ref-docs/claude/setup.md` → `{DOC_ROOT}/claude/setup.md`
- `Ref-docs/claude/` (별도 문서 위치) → `{DOC_ROOT}/claude/`

### 9단계: .gitignore 업데이트

```bash
grep -q 'context.db' .gitignore 2>/dev/null || echo -e '\n# Claude Code runtime\n.claude/db/context.db' >> .gitignore
grep -q '.ctx_state' .gitignore 2>/dev/null || echo '.claude/.ctx_state' >> .gitignore
grep -q '.backup-' .gitignore 2>/dev/null || echo '.claude/.backup-*' >> .gitignore
grep -q '.ralph_state' .gitignore 2>/dev/null || echo '.claude/.ralph_state' >> .gitignore
grep -q '.hud_cache' .gitignore 2>/dev/null || echo '.claude/.hud_cache' >> .gitignore
grep -q '.hook_feedback' .gitignore 2>/dev/null || echo '.claude/.hook_feedback' >> .gitignore
grep -q '.project_root' .gitignore 2>/dev/null || echo '.claude/.project_root' >> .gitignore
grep -q '.messenger_enabled' .gitignore 2>/dev/null || echo '.claude/.messenger_enabled' >> .gitignore
```

### 10단계: 정리

```bash
rm -rf "$DOTCLAUDE_TMP"
```

## 완료 메시지

```
## 업데이트 완료

설치 소스: https://github.com/leonardo204/dotclaude

프로젝트 로컬 (.claude/):
- agents/ (시스템 7개 + 프로젝트 고유 N개 보존)
- dist/hooks/bridge.js, dist/hud/, dist/mcp/server.js
- commands/ (시스템 8개 + 프로젝트 고유 N개 보존)
- scripts/ (messenger.sh, context-monitor.mjs)
- db/ (init.sql, helper.sh — context.db 유지)
- settings.json (시스템 hooks + 프로젝트 고유 설정 머지)
- .mcp.json (MCP 서버 자동 시작 설정)
- {DOC_ROOT}/claude/ (ref-docs 4개)
- CLAUDE.md (PROJECT 보존, ref-docs 경로 치환)

글로벌 (~/.claude/):
- scripts/ (messenger.sh, context-monitor.mjs)
- commands/ (dotclaude-init, dotclaude-update)
- CLAUDE.md

다음 단계:
1. CLAUDE.md PROJECT 섹션 확인
2. 다음 세션부터 자동 추적 시작
```

## 주의사항

- **파일 내용을 절대 기억해서 작성하지 않는다** — 반드시 repo에서 복사
- **클린 설치 전 반드시 충돌 영향 분석 → 사용자 확인**
- context.db는 유지 (기존 세션 데이터 보존)
- CLAUDE.md의 PROJECT 섹션은 반드시 보존
- 프로젝트 고유 파일(시스템 파일명 외)은 절대 삭제하지 않는다
