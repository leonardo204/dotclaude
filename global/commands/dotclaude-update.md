dotclaude 시스템 파일을 최신 버전으로 업데이트 / 시스템 파일 클린 재설치

## 핵심 원칙

- **배포는 manifest 기반이다.** 복사 대상은 repo 루트 `manifest.json` 하나로 정의되며, 모든 배포는 `bin/apply-manifest.mjs` 를 통해 수행한다. **하드코딩된 복사 목록을 두지 않는다.**
- **모든 시스템 파일은 dotclaude 저장소에서 직접 복사한다. 절대 내용을 기억해서 작성하지 않는다.**
- **버저닝 skip**: apply-manifest 는 스탬프(글로벌 `.dotclaude-installed` 의 `applied_sha=`, 로컬 `.dotclaude-version`)를 repoSHA 와 비교해 이미 최신이면 전체 skip 한다. 강제 재적용은 `--force`.
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
SRC="$DOTCLAUDE_TMP/project-local"   # 프로젝트별 개별 단계(문서/CLAUDE.md 등)에서 사용
```

클론 실패 시 중단.

> `apply-manifest` 는 **clone 쪽**(`$DOTCLAUDE_TMP/bin/apply-manifest.mjs`)을 호출한다.
> 설치본(`~/.claude/bin/`)이 구버전일 수 있으므로, 항상 방금 clone 한 최신 배포 로직을 사용한다.

### 2-b단계: 커맨드 자가 업데이트

repo의 최신 커맨드와 현재 실행 중인 커맨드를 비교한다.
다르면 **글로벌 커맨드 파일만** 교체하고, 사용자에게 재실행을 안내한 뒤 **이번 실행은 중단**한다.

> ⚠️ **여기서는 스탬프도 scripts/dist 도 건드리지 않는다.**
> 구버전 update 명령이 명령 파일만 교체 후 중단→재실행되는 흐름에서, 만약 이 지점에서 글로벌 스탬프를 기록해버리면 재실행 때 글로벌 apply 가 skip 되어 messenger(`dist/messenger/cli.js`) 등이 영구 미배포된다. 통합 글로벌 동기화는 재실행 후 4-b단계(apply-manifest)에서 원자적으로 수행한다.

```bash
if ! diff -q "$DOTCLAUDE_TMP/global/commands/dotclaude-update.md" ~/.claude/commands/dotclaude-update.md >/dev/null 2>&1; then
    echo "[self-update] dotclaude-update 커맨드가 업데이트되었습니다."
fi
```

**커맨드가 변경된 경우:**
1. 글로벌 커맨드 **파일만** 교체: `cp "$DOTCLAUDE_TMP/global/commands/"*.md ~/.claude/commands/`
2. 사용자에게 안내:
   ```
   dotclaude-update 커맨드가 최신 버전으로 교체되었습니다.
   `/dotclaude-update`를 다시 실행하면 글로벌·프로젝트 파일이 최신으로 동기화됩니다.
   (스탬프/스크립트/dist 는 이 단계에서 건드리지 않았습니다 — 재실행 시 apply-manifest 가 통합 처리)
   ```
3. `rm -rf "$DOTCLAUDE_TMP"` 후 **중단** (실제 배포는 재실행 시 4-b/4단계에서 수행)

**커맨드가 동일한 경우:** 다음 단계(3단계)로 계속 진행.

### 3단계: 충돌 영향 분석

클린 설치 전에 기존 파일과의 충돌을 분석하여 사용자에게 리포트한다.
**하드코딩된 시스템 파일 목록(SYS_AGENTS/SYS_CMDS)을 두지 않는다.** 시스템 파일 집합은
방금 clone 한 repo(`$SRC/...`)의 실제 파일 목록과 `apply-manifest --dry-run` 결과로 판단한다.

#### 3-1. apply-manifest dry-run (미리보기)

```bash
# 로컬 스코프 미리보기: 어떤 엔트리가 적용/보존(사용자 수정)/skip 되는지 분류
node "$DOTCLAUDE_TMP/bin/apply-manifest.mjs" \
  --scope local --src "$DOTCLAUDE_TMP" --dest "$(pwd)/.claude" --dry-run
# 출력: {"scope":"local","applied":[...],"skipped":[...],"preserved":[...],"sha":"..."}
#  - preserved: 사용자가 수정한 replace-if-unmodified 엔트리 (덮어쓰지 않음)
```

#### 3-2. 커스터마이징 감지 (repo 기준 — 하드코딩 없음)

시스템 파일과 동일 이름이지만 내용이 변경된 파일을 찾는다. 시스템 파일 집합은
**clone 된 repo 디렉토리**에서 파생한다(하드코딩 목록 아님):

```bash
# 시스템 에이전트 = repo 의 project-local/agents/*.md. 그중 로컬에서 수정된 것.
for f in "$SRC"/agents/*.md; do
    name=$(basename "$f")
    if [ -f ".claude/agents/$name" ] && ! diff -q "$f" ".claude/agents/$name" >/dev/null 2>&1; then
        echo "[변경됨] agents/$name"
    fi
done

# 시스템 command = repo 의 project-local/commands/*.md. 그중 로컬에서 수정된 것.
for f in "$SRC"/commands/*.md; do
    name=$(basename "$f")
    if [ -f ".claude/commands/$name" ] && ! diff -q "$f" ".claude/commands/$name" >/dev/null 2>&1; then
        echo "[변경됨] commands/$name"
    fi
done
```

#### 3-3. 프로젝트 고유 파일 식별 (repo 부재 = 고유)

시스템 파일 이름 목록을 **하드코딩하지 않는다.** repo(`$SRC`)에 없는 로컬 파일이 곧 프로젝트 고유 파일이다.
overlay 복사(apply-manifest 의 recursive replace)는 목록에 없는 파일을 **삭제하지 않으므로** 이들은 항상 보존된다.

```bash
# 프로젝트 고유 에이전트: repo project-local/agents/ 에 없는 로컬 에이전트
for f in .claude/agents/*.md; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    [ -f "$SRC/agents/$name" ] || echo "[프로젝트 고유] agents/$name (보존됨)"
done

# 프로젝트 고유 command
for f in .claude/commands/*.md; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    [ -f "$SRC/commands/$name" ] || echo "[프로젝트 고유] commands/$name (보존됨)"
done
```

#### 3-4. CLAUDE.md 변경 감지

```bash
if [ -f "CLAUDE.md" ]; then
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

#### 3-5. settings.json 충돌 분석

apply-manifest 의 `merge-hooks` 정책이 hooks 만 교체하고 나머지 사용자 키(enabledPlugins/permissions 등)는 보존한다.
프로젝트 고유 hook 등록이 있는지만 추가 확인한다:

```bash
cat .claude/settings.json 2>/dev/null   # 기존
cat "$SRC/settings.json"                # 시스템(로컬 템플릿)
```

#### 3-6. 사용자에게 영향 리포트

```
## 충돌 영향 분석

### 커스터마이징된 시스템 파일 (교체 시 변경사항 유실)
- agents/reviewer.md — 프로젝트 맞춤 리뷰 기준 포함
(없으면: "커스터마이징 없음 ✅")

### 사용자 수정 보존 (apply-manifest preserved)
- (dry-run preserved 목록 — replace-if-unmodified 로 보존됨)

### 프로젝트 고유 파일 (영향 없음 — 보존됨)
- agents/data-analyst.md
(없으면: "프로젝트 고유 파일 없음")

### CLAUDE.md
- PROJECT 섹션 보존 후 시스템 부분 재구성

### settings.json 프로젝트 고유 설정
- merge-hooks 로 hooks 만 교체, 나머지 키 보존됨

### 권장 조치
- [자동] 프로젝트 고유 파일/사용자 키는 보존됩니다
- [확인 필요] 커스터마이징된 시스템 파일 N개가 repo 버전으로 교체됩니다

진행할까요? (Y: 전체 진행 / N: 중단 / F: --force 강제 재적용)
```

### 4단계: 로컬 시스템 파일 클린 설치 (manifest)

사용자 승인 후, 로컬 스코프 배포를 apply-manifest 한 줄로 수행한다.
개별 `cp` 를 두지 않는다 — 배포 대상은 manifest 가 정의한다.

```bash
node "$DOTCLAUDE_TMP/bin/apply-manifest.mjs" \
  --scope local --src "$DOTCLAUDE_TMP" --dest "$(pwd)/.claude"
```

- 출력이 `{"skipped":true,"reason":"up-to-date"}` 이면:
  ```
  이 프로젝트는 이미 최신입니다 (로컬 스탬프 == repoSHA).
  강제 재적용하려면? (N)  → 예 선택 시 위 명령에 --force 를 붙여 재실행
  ```
- overlay 복사이므로 프로젝트 고유 파일(agents/commands 등 목록 외)은 삭제되지 않는다.
- `context.db` 는 manifest 에 없어(런타임 산출물) 덮어쓰지 않는다.

### 4-b단계: 글로벌 파일 동기화 (manifest)

`~/.claude/` 글로벌 파일도 최신으로 동기화한다. Hook 이 글로벌 경로(`~/.claude/scripts/`, `~/.claude/dist/`)를 참조하므로 이 단계를 누락하면 구버전이 실행된다. **한 줄**로 통합 수행한다:

```bash
node "$DOTCLAUDE_TMP/bin/apply-manifest.mjs" \
  --scope global --src "$DOTCLAUDE_TMP" --dest ~/.claude
```

- 출력이 `{"skipped":true,"reason":"up-to-date"}` 이면 그대로:
  ```
  글로벌 공통 환경 이미 최신 ✅
  ```
- 그 외에는 applied/preserved 목록을 요약 보고한다.
- 이 명령은 dist 를 recursive 복사하므로 hooks/hud/**messenger** 및 향후 추가 진입점을 자동 포함한다(하위목록 열거 금지).
- 강제 재적용: `--force` 추가.

### 5단계: settings.json 처리 (프로젝트 로컬)

apply-manifest 의 로컬 스코프에는 프로젝트 `settings.json` 병합이 포함되지 않으므로(로컬 settings 는 프로젝트별 특성이 크다), 여기서 별도 처리한다.

#### 프로젝트 고유 설정이 없는 경우

```bash
cp "$SRC"/settings.json .claude/settings.json
```

#### 프로젝트 고유 설정이 있는 경우

1. `$SRC/settings.json` 을 베이스로 사용 (hooks = 최신)
2. 기존 settings.json 에서 hooks 외 프로젝트 고유 키(enabledPlugins, permissions, statusLine 등) 추출
3. 베이스에 프로젝트 고유 키 추가
4. 프로젝트 고유 hook 등록이 있으면 시스템 hooks 배열에 append

### 6단계: Context DB

```bash
[ ! -f ".claude/db/context.db" ] && sqlite3 .claude/db/context.db < .claude/db/init.sql
```

### 7단계: 문서 폴더 감지 + ref-docs 복사

프로젝트의 기존 문서 폴더를 감지하여 ref-docs를 적절한 위치에 복사한다.

#### 7-1. 문서 폴더 감지

```bash
DOC_DIRS=""
for d in docs documentation ref-docs Ref-docs doc wiki; do
    [ -d "$d" ] && DOC_DIRS="$DOC_DIRS $d"
done
```

#### 7-2. 사용자 확인 및 경로 결정

**여러 개 발견 시:** 목록을 보여주고 복사 대상 폴더를 선택받아 `$DOC_ROOT` 로 설정.
**하나만 발견 시:** `이 폴더에 ref-docs를 복사할까요? (Y/N)` — Y면 그 폴더, N이면 `ref-docs`.
**없으면:** `$DOC_ROOT=ref-docs`.

#### 7-3. ref-docs 파일 복사

```bash
DOC_ROOT="{감지/선택된 폴더}"
mkdir -p "$DOC_ROOT/claude" "$DOC_ROOT/specs"

# 하니스 문서 전체 복사 (읽기 전용). 누락 문서 자동 보충 — 멱등 마이그레이션.
cp "$DOTCLAUDE_TMP/ref-docs/"*.md "$DOC_ROOT/claude/"

[ -f "$DOC_ROOT/claude/_README.md" ] || cat > "$DOC_ROOT/claude/_README.md" <<'HARNESS_EOF'
# 🔒 dotclaude 하니스 문서 (자동 생성 · 수정 금지)

이 폴더는 dotclaude 하니스가 소유합니다. `dotclaude-update`가 덮어쓰므로 **수정하지 마세요**.
프로젝트 스펙/문서는 `../specs/`(SDD)나 상위 폴더에 작성합니다. → 가이드: `sdd.md`
HARNESS_EOF

[ -f "$DOC_ROOT/specs/README.md" ] || cat > "$DOC_ROOT/specs/README.md" <<'SPECS_EOF'
# specs — 프로젝트 스펙 문서 (SDD)

- 가이드라인: `../claude/sdd.md`
- 정합성 분석: `/spec-guard` (영향도·중복·범위·누락·버전)
- 분류: `design/` `impl/` `interface/` `test/`
SPECS_EOF
```

### 8단계: CLAUDE.md 재구성

#### 기존 CLAUDE.md가 없는 경우

```bash
cp "$SRC/CLAUDE.md" CLAUDE.md
```
사용자에게 PROJECT 섹션 작성 안내.

#### 기존 CLAUDE.md가 있는 경우

1. 기존 CLAUDE.md에서 **PROJECT 섹션 내용을 추출**하여 보존
2. repo 템플릿(`$SRC/CLAUDE.md`)을 기반으로 사용
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

`$DOC_ROOT`가 `ref-docs`가 아닌 경우:

```bash
sed -i '' "s|ref-docs/\([a-z][a-z-]*\.md\)|${DOC_ROOT}/claude/\1|g; s|Ref-docs/claude/|${DOC_ROOT}/claude/|g" CLAUDE.md
```

### 9단계: .gitignore 업데이트

```bash
grep -q 'context.db' .gitignore 2>/dev/null || echo -e '\n# Claude Code runtime\n.claude/db/context.db' >> .gitignore
grep -q '.ctx_state' .gitignore 2>/dev/null || echo '.claude/.ctx_state' >> .gitignore
grep -q '.backup-' .gitignore 2>/dev/null || echo '.claude/.backup-*' >> .gitignore
grep -q '.ralph_state' .gitignore 2>/dev/null || echo '.claude/.ralph_state' >> .gitignore
grep -q '.hud_cache' .gitignore 2>/dev/null || echo '.claude/.hud_cache' >> .gitignore
grep -q '.cost_state' .gitignore 2>/dev/null || echo '.claude/.cost_state' >> .gitignore
grep -q '.hook_feedback' .gitignore 2>/dev/null || echo '.claude/.hook_feedback' >> .gitignore
grep -q '.project_root' .gitignore 2>/dev/null || echo '.claude/.project_root' >> .gitignore
grep -q '.messenger_enabled' .gitignore 2>/dev/null || echo '.claude/.messenger_enabled' >> .gitignore
grep -q '.dotclaude-version' .gitignore 2>/dev/null || echo '.claude/.dotclaude-version' >> .gitignore
grep -q '.dotclaude-manifest' .gitignore 2>/dev/null || echo '.claude/.dotclaude-manifest.json' >> .gitignore
```

### 10단계: 정리

```bash
rm -rf "$DOTCLAUDE_TMP"
```

## 완료 메시지

```
## 업데이트 완료

설치 소스: https://github.com/leonardo204/dotclaude
배포 방식: manifest.json + bin/apply-manifest.mjs (버저닝 skip)

프로젝트 로컬 (.claude/):
- apply-manifest --scope local 결과 (applied / preserved / skipped)
- settings.json (시스템 hooks + 프로젝트 고유 설정 머지)
- {DOC_ROOT}/claude/ (ref-docs)
- CLAUDE.md (PROJECT 보존, ref-docs 경로 치환)

글로벌 (~/.claude/):
- apply-manifest --scope global 결과 (skip 시 "이미 최신 ✅")

다음 단계:
1. CLAUDE.md PROJECT 섹션 확인
2. 다음 세션부터 자동 추적 시작
```

## 주의사항

- **배포 대상은 manifest.json 이 단일 소스** — 개별 `cp` 나 하드코딩 목록을 추가하지 않는다
- **파일 내용을 절대 기억해서 작성하지 않는다** — 반드시 repo에서 복사
- **클린 설치 전 반드시 충돌 영향 분석 → 사용자 확인**
- **apply-manifest 는 항상 clone 쪽(`$DOTCLAUDE_TMP/bin/`)을 호출** — 설치본이 구버전일 수 있음
- context.db는 유지 (기존 세션 데이터 보존)
- CLAUDE.md의 PROJECT 섹션은 반드시 보존
- 프로젝트 고유 파일(시스템 파일명 외)은 절대 삭제하지 않는다 (overlay 복사)
- 이미 최신이면 skip — 강제 재적용은 `--force`
