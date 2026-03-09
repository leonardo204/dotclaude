기존 프로젝트를 ClaudeCodeRules 시스템으로 마이그레이션 (.claude/ 구조 전환)

## 사전 확인

1. 현재 디렉토리가 git 프로젝트 루트인지 확인:
   ```bash
   git rev-parse --show-toplevel
   ```

2. 기존 상태 파악 — 아래 항목을 모두 확인하고 사용자에게 현황 보고:
   ```bash
   # 기존 .claude/ 구조
   find .claude -type f 2>/dev/null | head -30

   # 기존 CLAUDE.md
   cat CLAUDE.md 2>/dev/null

   # 기존 settings.json
   cat .claude/settings.json 2>/dev/null

   # 기존 hooks
   ls .claude/hooks/ 2>/dev/null

   # 기존 commands
   ls .claude/commands/ 2>/dev/null
   ```

3. 사용자에게 현황 리포트 후 진행 확인:
   ```
   ## 마이그레이션 현황
   - CLAUDE.md: 있음/없음 (N줄)
   - .claude/settings.json: 있음/없음
   - .claude/hooks/: N개 파일
   - .claude/commands/: N개 파일
   - .claude/db/: 있음/없음

   이 상태에서 마이그레이션을 진행합니다. 계속할까요?
   ```

## 실행 순서

### 1단계: 기존 설정 백업

```bash
# 백업 디렉토리 생성
BACKUP_DIR=".claude/.backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 기존 파일 백업
[ -f "CLAUDE.md" ] && cp CLAUDE.md "$BACKUP_DIR/CLAUDE.md"
[ -f ".claude/settings.json" ] && cp .claude/settings.json "$BACKUP_DIR/settings.json"
[ -d ".claude/hooks" ] && cp -r .claude/hooks "$BACKUP_DIR/hooks"
[ -d ".claude/commands" ] && cp -r .claude/commands "$BACKUP_DIR/commands"
```

사용자에게 백업 경로 안내: `"기존 설정을 $BACKUP_DIR 에 백업했습니다."`

### 2단계: 디렉토리 구조 보장

```bash
mkdir -p .claude/agents
mkdir -p .claude/db
mkdir -p .claude/hooks
mkdir -p .claude/commands
mkdir -p .claude/scripts
```

### 3단계: 에이전트 설치

`.claude/agents/` 에 커스텀 에이전트 7개 설치:
- `ralph.md`, `planner.md`, `architect.md`, `verifier.md`, `reviewer.md`, `debugger.md`, `test-engineer.md`

기존 `.claude/agents/`에 프로젝트 고유 에이전트가 있으면 **보존** (시스템 에이전트와 이름 충돌 시 사용자 확인).

### 4단계: Context DB 설치

DB가 없는 경우에만 초기화. 기존 DB가 있으면 스키마 호환성 확인.

```bash
if [ ! -f ".claude/db/context.db" ]; then
    # init.sql 생성 + DB 초기화 (project-init과 동일)
    echo "DB 신규 생성"
else
    # 기존 DB의 스키마 버전 확인
    sqlite3 .claude/db/context.db "SELECT value FROM db_meta WHERE key='schema_version';" 2>/dev/null
    echo "기존 DB 유지 — 스키마 호환 확인 필요"
fi
```

- `init.sql`이 없으면 생성 (project-init 2단계와 동일 내용)
- `helper.sh`가 없으면 생성 (project-init 3단계와 동일)

### 5단계: Hooks 머지

**핵심 원칙**: 기존 프로젝트 고유 hooks는 보존하고, 시스템 hooks만 추가/업데이트.

시스템 hooks 6개:
- `session-start.sh`, `on-prompt.sh`, `post-tool-edit.sh`, `post-tool-bash.sh`, `on-stop.sh`, `ralph-persist.sh`

각 파일에 대해:
- **없으면**: 새로 생성 (project-local/hooks/ 내용 그대로)
- **있으면**: 기존 내용을 읽고, 시스템 hook과 diff 비교
  - 사용자에게 "기존 hook에 커스텀 로직이 있습니다. 교체/머지/스킵 중 선택해주세요" 확인
  - 프로젝트 고유 로직이 있으면 보존하되 시스템 hook 기능도 포함되도록 머지

### 6단계: settings.json 머지

기존 settings.json이 있으면 **머지** (덮어쓰기 금지):

1. 기존 JSON 읽기
2. `hooks` 키에 시스템 hook 등록 추가 (기존 hooks 보존)
3. 기존에 없는 hook event만 추가, 이미 있는 event는 배열에 append

예시 머지 로직:
- 기존에 `PostToolUse`에 커스텀 matcher가 있으면 → 시스템 matcher(Edit, Bash)를 배열 끝에 추가
- 기존에 `SessionStart`가 있으면 → 시스템 hook을 hooks 배열에 추가
- 기존에 없는 event(Stop 등) → 새로 생성

**중요**: 기존 hook 설정이 삭제되지 않도록 반드시 머지 방식으로 처리.

### 7단계: HUD / Context Monitor 설치

#### 6-0. 배경 지식

Claude Code의 `statusLine` 설정은 **스코프 우선순위**가 있다:
```
Project .claude/settings.json  >  Global ~/.claude/settings.json
```
Project에 `statusLine`이 있으면 Global을 **완전 대체** (머지 아님).
따라서 HUD 설치 위치 선택이 중요하다.

#### 6-1. 현재 HUD 상태 확인

아래를 모두 확인하고 사용자에게 리포트:

```bash
# 글로벌 statusline 확인
cat ~/.claude/settings.json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
sl=d.get('statusLine')
if sl: print(f'Global statusLine: {sl.get(\"command\",\"(unknown)\")}')
else: print('Global statusLine: 없음')
" 2>/dev/null

# 프로젝트 statusline 확인
cat .claude/settings.json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
sl=d.get('statusLine')
if sl: print(f'Project statusLine: {sl.get(\"command\",\"(unknown)\")}')
else: print('Project statusLine: 없음')
" 2>/dev/null

# HUD 스크립트 파일 확인
ls ~/.claude/scripts/context-monitor.mjs 2>/dev/null
ls .claude/scripts/context-monitor.mjs 2>/dev/null
# 기존 HUD 스크립트 확인
ls ~/.claude/hud/ 2>/dev/null
```

#### 6-2. 사용자에게 설치 옵션 제시

확인 결과를 바탕으로 아래 형태로 옵션 제시:

```
## HUD 설치 옵션

현재 상태:
- Global statusLine: {있음/없음} → {command 내용}
- Project statusLine: {있음/없음} → {command 내용}

설치 위치를 선택하세요:

(A) Global 설치 (권장)
    → ~/.claude/scripts/context-monitor.mjs 에 설치
    → ~/.claude/settings.json 의 statusLine 설정
    → 모든 프로젝트에서 동일 HUD 사용
    → 프로젝트별 statusLine 설정이 있으면 Global이 무시됨 (주의)

(B) Project 설치
    → .claude/scripts/context-monitor.mjs 에 설치
    → .claude/settings.json 의 statusLine 설정
    → 이 프로젝트에서만 사용
    → Global statusLine이 있어도 이 프로젝트에선 Project 것이 우선

(C) 스킵
    → 기존 HUD 설정 유지, 스크립트만 .claude/scripts/에 복사 (설정 변경 없음)
```

#### 6-3. 선택에 따른 설치

**(A) Global 설치 선택 시:**

```bash
# 스크립트 설치
mkdir -p ~/.claude/scripts
# context-monitor.mjs 내용을 ~/.claude/scripts/context-monitor.mjs에 작성
```

`~/.claude/settings.json`에 statusLine 추가/업데이트:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/scripts/context-monitor.mjs",
    "padding": 2
  }
}
```

이 프로젝트의 `.claude/settings.json`에 `statusLine`이 있으면 **제거** (Global이 적용되도록):
- 제거 전 사용자에게 확인: "프로젝트 statusLine 설정을 제거해야 Global HUD가 적용됩니다. 진행할까요?"

**(B) Project 설치 선택 시:**

```bash
# 스크립트 설치
mkdir -p .claude/scripts
# context-monitor.mjs 내용을 .claude/scripts/context-monitor.mjs에 작성
```

`.claude/settings.json`에 statusLine 추가/업데이트:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node .claude/scripts/context-monitor.mjs",
    "padding": 2
  }
}
```

사용자에게 안내: "Global statusLine이 있어도 이 프로젝트에서는 Project 설정이 우선합니다."

**(C) 스킵 선택 시:**

```bash
# 스크립트만 복사 (나중에 사용할 수 있도록)
mkdir -p .claude/scripts
# context-monitor.mjs 내용을 .claude/scripts/context-monitor.mjs에 작성
```

statusLine 설정은 변경하지 않음.
사용자에게 안내: "HUD 스크립트는 .claude/scripts/에 복사했습니다. 필요 시 settings.json에 statusLine을 수동 설정하세요."

#### 6-4. 기존 HUD와의 충돌 처리

- **기존 HUD 스크립트가 있는 경우**: "기존 HUD 스크립트가 있습니다. 시스템 HUD로 교체하면 기존 HUD가 비활성화됩니다. 교체/스킵을 선택하세요."
- **커스텀 statusline 사용 중인 경우**: "기존 커스텀 statusline이 있습니다. 기존 스크립트를 백업 후 교체하시겠습니까?"
- **statusLine이 전혀 없는 경우**: Global 설치를 기본 권장

### 8단계: Commands 머지

시스템 commands 5개: `implement.md`, `commit.md`, `tellme.md`, `discover.md`, `reportdb.md`

각 파일에 대해:
- **없으면**: 새로 생성
- **있으면**: 사용자에게 "기존 command를 시스템 버전으로 교체할까요?" 확인

기존 프로젝트 고유 commands (위 4개 외)는 **절대 삭제하지 않고 그대로 보존**.

### 9단계: CLAUDE.md 재구성 (핵심)

이 단계가 마이그레이션의 핵심이다. 기존 CLAUDE.md를 COMMON + PROJECT 구조로 전환한다.

#### 8-1. 기존 CLAUDE.md 분석

기존 CLAUDE.md 전체를 읽고 내용을 분류:

| 카테고리 | 설명 | 처리 |
|----------|------|------|
| 언어/커밋 정책 | 언어 선택, 커밋 컨벤션 등 | COMMON에 이미 포함 → 중복 제거 |
| DB/Hook/Monitor 관련 | Context DB, live context 등 | COMMON에 이미 포함 → 중복 제거 |
| 프로젝트 개요 | 프로젝트명, 기술 스택, 빌드 방법 | → PROJECT 섹션 "개요"로 이동 |
| 아키텍처/구조 | 디렉토리 구조, 모듈 설명 | → 3줄 요약 후 상세는 `Ref-docs/claude/architecture.md`로 분리 |
| 코딩 규칙 | 프로젝트 고유 코딩 컨벤션 | → PROJECT 섹션 "핵심 규칙"으로 이동 (slim) |
| API/외부 서비스 | API 키 설정, 서비스 연동 | → PROJECT 섹션에 1줄 요약 + 상세 문서 링크 |
| 작업 히스토리 | 완료된 작업, 변경 로그 | → `Ref-docs/claude/history.md`로 분리 또는 삭제 |
| 기타 상세 설명 | 긴 설명, 예제 코드 등 | → 적절한 ref-doc으로 분리 |

#### 8-2. 상세 문서 분리

CLAUDE.md에서 5줄 이상의 상세 설명 블록은 별도 문서로 분리:

```bash
mkdir -p Ref-docs/claude
```

분리 대상별 파일 생성:
- 아키텍처 상세 → `Ref-docs/claude/architecture.md`
- 작업 히스토리 → `Ref-docs/claude/history.md`
- 기타 도메인 지식 → `Ref-docs/claude/<topic>.md`

#### 8-3. 새 CLAUDE.md 작성

아래 템플릿 구조로 재작성. **COMMON 섹션은 시스템 표준**, PROJECT 섹션은 기존 내용을 slim하게 정리:

```markdown
# Claude Code 개발 가이드

---

## COMMON

(시스템 표준 COMMON 섹션 — project-local/CLAUDE.md의 COMMON과 동일)

---

## PROJECT

### 개요

**{프로젝트명}** — {한 줄 설명}

| 항목 | 값 |
|------|-----|
| 기술 스택 | {기존 CLAUDE.md에서 추출} |
| 빌드 방법 | {기존 CLAUDE.md에서 추출} |
| 상태 | {개발 중/출시} |

### 상세 문서

- [아키텍처](Ref-docs/claude/architecture.md) — 디렉토리 구조, 모듈 관계
- [히스토리](Ref-docs/claude/history.md) — 작업 이력, 변경 로그
- {기타 분리된 문서 링크}

### 핵심 규칙

- {기존 CLAUDE.md에서 추출한 프로젝트 고유 규칙, 항목당 1줄}
- {금지 사항}
- {네이밍 컨벤션 등}

---

*최종 업데이트: {오늘 날짜}*
```

#### 8-4. 사용자 검토

새 CLAUDE.md 초안을 사용자에게 보여주고 확인:
- "기존 내용 중 누락된 것이 있나요?"
- "PROJECT 섹션의 요약이 적절한가요?"
- "분리된 상세 문서의 위치가 괜찮은가요?"

### 10단계: .gitignore 업데이트

```bash
# context.db, .ctx_state, 백업 폴더를 gitignore에 추가
grep -q 'context.db' .gitignore 2>/dev/null || echo -e '\n# Claude Code Context DB\n.claude/db/context.db' >> .gitignore
grep -q '.ctx_state' .gitignore 2>/dev/null || echo '.claude/.ctx_state' >> .gitignore
grep -q '.backup-' .gitignore 2>/dev/null || echo '.claude/.backup-*' >> .gitignore
```

## 완료 메시지

```
## 마이그레이션 완료

### 백업
- 기존 설정: {$BACKUP_DIR}/

### 새로 설치
- .claude/db/ (Context DB + Helper CLI)
- .claude/hooks/ (5개 시스템 hook)
- .claude/commands/ (4개 시스템 command)
- .claude/scripts/context-monitor.mjs (HUD + 모니터)

### 전환됨
- CLAUDE.md → COMMON + PROJECT 구조로 재구성
- 상세 내용 → Ref-docs/claude/ 로 분리

### 보존됨
- 기존 프로젝트 고유 hooks: {목록}
- 기존 프로젝트 고유 commands: {목록}
- 기존 settings.json 커스텀 설정

### 다음 단계
1. CLAUDE.md의 PROJECT 섹션 검토 및 보완
2. Ref-docs/claude/ 분리 문서 검토
3. 다음 세션부터 자동 추적 시작
```

## 주의사항

- **절대 기존 파일을 백업 없이 삭제/덮어쓰기 하지 않는다**
- settings.json은 항상 머지 (기존 hook 설정 보존)
- 기존 프로젝트 고유 commands/hooks는 절대 삭제하지 않는다
- CLAUDE.md 재구성 시 정보 유실 방지: 원본은 백업, 분류 불확실한 내용은 PROJECT 섹션에 일단 포함
- 마이그레이션 후 기존 백업은 1주일 후 사용자가 직접 삭제 (자동 삭제 금지)
