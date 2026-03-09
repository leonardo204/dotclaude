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

3. 이미 존재하면 사용자에게 확인:
   - 기존 설정이 있다면 `/dotclaude-migration` 사용 권장
   - 강제 초기화 원할 시 백업 후 진행

## 실행 순서

### 1단계: dotclaude 저장소 가져오기

```bash
DOTCLAUDE_TMP=$(mktemp -d)
git clone --depth 1 https://github.com/leonardo204/dotclaude.git "$DOTCLAUDE_TMP"
```

클론 실패 시 사용자에게 안내하고 중단. 이후 모든 파일은 `$DOTCLAUDE_TMP/project-local/`에서 복사한다.

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

### 5단계: CLAUDE.md 생성

프로젝트 루트에 `CLAUDE.md`가 없으면 템플릿 복사:

```bash
[ ! -f "CLAUDE.md" ] && cp "$SRC/CLAUDE.md" CLAUDE.md
```

이미 있으면 스킵하고 사용자에게 안내: "기존 CLAUDE.md를 유지합니다. PROJECT 섹션을 확인하세요."

### 6단계: HUD 설치

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

### 7단계: .gitignore 업데이트

```bash
grep -q 'context.db' .gitignore 2>/dev/null || echo -e '\n# Claude Code runtime\n.claude/db/context.db' >> .gitignore
grep -q '.ctx_state' .gitignore 2>/dev/null || echo '.claude/.ctx_state' >> .gitignore
grep -q '.backup-' .gitignore 2>/dev/null || echo '.claude/.backup-*' >> .gitignore
grep -q '.ralph_state' .gitignore 2>/dev/null || echo '.claude/.ralph_state' >> .gitignore
grep -q '.hud_cache' .gitignore 2>/dev/null || echo '.claude/.hud_cache' >> .gitignore
grep -q '.hook_feedback' .gitignore 2>/dev/null || echo '.claude/.hook_feedback' >> .gitignore
```

### 8단계: 정리

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
- CLAUDE.md (PROJECT 섹션 작성 필요)

다음 단계:
1. CLAUDE.md의 PROJECT 섹션을 프로젝트에 맞게 작성
2. 다음 세션부터 자동 추적 시작
```

## 주의사항

- **파일 내용을 절대 기억해서 작성하지 않는다** — 반드시 repo에서 복사
- 기존 `.claude/` 파일이 있으면 덮어쓰기 전 반드시 확인
- `context.db`는 `.gitignore`에 추가 (개인 작업 기록)
- `init.sql`, `helper.sh`, hooks, commands는 git 추적 권장 (팀 공유)
