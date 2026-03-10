프로젝트 Claude Code 환경 초기화 (.claude/ 폴더 자동 생성)

## 핵심 원칙

**모든 파일은 dotclaude 저장소에서 직접 복사한다. 절대 내용을 기억해서 작성하지 않는다.**

## 사전 확인

1. 현재 디렉토리가 git 프로젝트 루트인지 확인:
   ```bash
   git rev-parse --show-toplevel
   ```

2. `.claude/` 폴더 존재 여부 확인:
   ```bash
   ls -la .claude/ 2>/dev/null
   ```

3. 이미 존재하면 **충돌 영향 분석 후 진행** (아래 "기존 .claude/ 감지 시 처리" 참조)

## 실행 순서

### 1단계: dotclaude 저장소 가져오기

```bash
DOTCLAUDE_TMP=$(mktemp -d)
git clone --depth 1 https://github.com/leonardo204/dotclaude.git "$DOTCLAUDE_TMP"
```

클론 실패 시 사용자에게 안내하고 중단. 이후 모든 파일은 `$DOTCLAUDE_TMP/project-local/`에서 복사한다.

### 1-A단계: 기존 .claude/ 감지 시 처리

`.claude/` 폴더가 이미 존재하면, 클린 설치 전에 충돌 영향 분석을 수행한다.

```bash
SRC="$DOTCLAUDE_TMP/project-local"
```

#### 커스터마이징 감지

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

# 시스템 hook 중 프로젝트에서 커스터마이징한 것
for f in "$SRC"/hooks/*.sh; do
    name=$(basename "$f")
    if [ -f ".claude/hooks/$name" ]; then
        if ! diff -q "$f" ".claude/hooks/$name" >/dev/null 2>&1; then
            echo "[변경됨] hooks/$name"
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

#### 프로젝트 고유 파일 식별

```bash
SYS_AGENTS="ralph planner architect verifier reviewer debugger test-engineer"
for f in .claude/agents/*.md; do
    name=$(basename "$f" .md)
    if ! echo "$SYS_AGENTS" | grep -qw "$name"; then
        echo "[프로젝트 고유] agents/$name.md"
    fi
done

SYS_HOOKS="session-start on-prompt post-tool-edit post-tool-bash on-stop ralph-persist"
for f in .claude/hooks/*.sh; do
    name=$(basename "$f" .sh)
    if ! echo "$SYS_HOOKS" | grep -qw "$name"; then
        echo "[프로젝트 고유] hooks/$name.sh"
    fi
done

SYS_CMDS="implement commit tellme discover reportdb"
for f in .claude/commands/*.md; do
    name=$(basename "$f" .md)
    if ! echo "$SYS_CMDS" | grep -qw "$name"; then
        echo "[프로젝트 고유] commands/$name.md"
    fi
done
```

#### settings.json 충돌 분석

```bash
cat .claude/settings.json 2>/dev/null
cat "$SRC/settings.json"
```

비교 항목:
- **hooks 외 설정** (statusLine, enabledPlugins, permissions 등): 교체 시 유실됨
- **프로젝트 고유 hook 등록**: 시스템 settings.json에 없는 hook event나 matcher

#### 사용자에게 영향 리포트

```
## 기존 .claude/ 감지 — 충돌 영향 분석

### 커스터마이징된 시스템 파일 (초기화 시 변경사항 유실)
- agents/reviewer.md — 프로젝트 맞춤 리뷰 기준 포함
(없으면: "커스터마이징 없음")

### 프로젝트 고유 파일 (영향 없음 — 보존됨)
- agents/data-analyst.md
(없으면: "프로젝트 고유 파일 없음")

### settings.json 프로젝트 고유 설정 (교체 시 유실)
- enabledPlugins: {...}
(없으면: "프로젝트 고유 설정 없음")

### 권장 조치
- [자동] 프로젝트 고유 파일은 그대로 보존됩니다
- [확인 필요] 커스터마이징된 시스템 파일 N개가 repo 버전으로 교체됩니다
- [확인 필요] settings.json의 프로젝트 고유 설정을 머지해야 합니다

진행할까요? (Y: 전체 진행 / N: 중단)
```

사용자 승인 후 아래 단계를 계속 진행한다. 중단 선택 시 `/dotclaude-update`를 안내한다.

### 2단계: 디렉토리 구조 생성

```bash
mkdir -p .claude/agents .claude/db .claude/hooks .claude/commands .claude/scripts
```

### 3단계: 파일 복사 (project-local → .claude/)

```bash
SRC="$DOTCLAUDE_TMP/project-local"

# 에이전트 (7개)
cp "$SRC"/agents/*.md .claude/agents/

# DB 스키마 + Helper CLI
cp "$SRC"/db/init.sql .claude/db/
cp "$SRC"/db/helper.sh .claude/db/

# Hooks (6개)
cp "$SRC"/hooks/*.sh .claude/hooks/
chmod +x .claude/hooks/*.sh

# Commands (5개)
cp "$SRC"/commands/*.md .claude/commands/

# HUD 스크립트
cp "$SRC"/scripts/context-monitor.mjs .claude/scripts/

# settings.json
cp "$SRC"/settings.json .claude/settings.json
```

### 4단계: Context DB 초기화

```bash
sqlite3 .claude/db/context.db < .claude/db/init.sql
```

### 5단계: 문서 폴더 감지 + ref-docs 복사

프로젝트의 기존 문서 폴더를 감지하여 ref-docs를 적절한 위치에 복사한다.

#### 5-1. 문서 폴더 감지

프로젝트 루트에서 일반적인 문서 폴더 패턴을 탐색:

```bash
DOC_DIRS=""
for d in docs documentation Ref-docs doc wiki; do
    [ -d "$d" ] && DOC_DIRS="$DOC_DIRS $d"
done
```

#### 5-2. 사용자 확인 및 경로 결정

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

#### 5-3. ref-docs 파일 복사

dotclaude repo의 `ref-docs/` 에서 감지된 문서 폴더의 `claude/` 서브폴더로 복사:

```bash
DOC_ROOT="{감지/선택된 폴더}"  # 예: docs, Ref-docs 등
mkdir -p "$DOC_ROOT/claude"
cp "$DOTCLAUDE_TMP/ref-docs/context-db.md" "$DOC_ROOT/claude/"
cp "$DOTCLAUDE_TMP/ref-docs/context-monitor.md" "$DOC_ROOT/claude/"
cp "$DOTCLAUDE_TMP/ref-docs/conventions.md" "$DOC_ROOT/claude/"
cp "$DOTCLAUDE_TMP/ref-docs/setup.md" "$DOC_ROOT/claude/"
```

### 6단계: CLAUDE.md 생성/재구성

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

### 7단계: HUD 설치

사용자에게 HUD 설치 위치 확인:

```
HUD 설치 위치를 선택하세요:
(A) Global 설치 (권장) — 모든 프로젝트에서 동일 HUD
(B) Project 설치 — 이 프로젝트에서만
(C) 스킵 — 기존 설정 유지
```

**참고**: Project statusLine은 Global을 완전 대체함.

**(A) Global 설치:**
```bash
mkdir -p ~/.claude/scripts
cp "$SRC"/scripts/context-monitor.mjs ~/.claude/scripts/
```
`~/.claude/settings.json`에 statusLine 추가 (기존 설정 보존, statusLine만 머지):
```json
{ "statusLine": { "type": "command", "command": "node ~/.claude/scripts/context-monitor.mjs", "padding": 2 } }
```

**(B) Project 설치:**
`.claude/settings.json`에 statusLine 추가:
```json
{ "statusLine": { "type": "command", "command": "node .claude/scripts/context-monitor.mjs", "padding": 2 } }
```

**(C) 스킵:** 설정 변경 없음.

### 8단계: .gitignore 업데이트

```bash
grep -q 'context.db' .gitignore 2>/dev/null || echo -e '\n# Claude Code runtime\n.claude/db/context.db' >> .gitignore
grep -q '.ctx_state' .gitignore 2>/dev/null || echo '.claude/.ctx_state' >> .gitignore
grep -q '.backup-' .gitignore 2>/dev/null || echo '.claude/.backup-*' >> .gitignore
grep -q '.ralph_state' .gitignore 2>/dev/null || echo '.claude/.ralph_state' >> .gitignore
grep -q '.hud_cache' .gitignore 2>/dev/null || echo '.claude/.hud_cache' >> .gitignore
grep -q '.hook_feedback' .gitignore 2>/dev/null || echo '.claude/.hook_feedback' >> .gitignore
grep -q '.project_root' .gitignore 2>/dev/null || echo '.claude/.project_root' >> .gitignore
```

### 9단계: 정리

```bash
rm -rf "$DOTCLAUDE_TMP"
```

## 완료 메시지

```
## 프로젝트 초기화 완료

설치 소스: https://github.com/leonardo204/dotclaude

생성된 파일:
- .claude/agents/ (7개 커스텀 에이전트)
- .claude/db/ (Context DB + Helper CLI)
- .claude/hooks/ (6개 자동 실행 스크립트)
- .claude/commands/ (5개 커스텀 명령어)
- .claude/scripts/ (HUD statusline)
- .claude/settings.json (Hook 등록)
- {DOC_ROOT}/claude/ (ref-docs 4개 — context-db, context-monitor, conventions, setup)
- CLAUDE.md (PROJECT 섹션 작성 필요, ref-docs 경로 치환 완료)

다음 단계:
1. CLAUDE.md의 PROJECT 섹션을 프로젝트에 맞게 작성
2. 다음 세션부터 자동 추적 시작
```

## 주의사항

- **파일 내용을 절대 기억해서 작성하지 않는다** — 반드시 repo에서 복사
- 기존 `.claude/` 파일이 있으면 덮어쓰기 전 반드시 확인
- `context.db`는 `.gitignore`에 추가 (개인 작업 기록)
- `init.sql`, `helper.sh`, hooks, commands는 git 추적 권장 (팀 공유)
