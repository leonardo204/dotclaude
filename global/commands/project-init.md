프로젝트 Claude Code 환경 초기화 (.claude/ 폴더 자동 생성)

## 사전 확인

1. 현재 디렉토리가 git 프로젝트 루트인지 확인:
   ```bash
   git rev-parse --show-toplevel
   ```

2. `.claude/` 폴더 존재 여부 확인:
   ```bash
   ls -la .claude/ 2>/dev/null
   ```

3. 이미 존재하면 사용자에게 "`.claude/` 폴더가 이미 존재합니다. 덮어쓸까요?" 확인

## 실행 순서

### 1단계: 디렉토리 구조 생성
```bash
mkdir -p .claude/db
mkdir -p .claude/hooks
mkdir -p .claude/commands
mkdir -p .claude/scripts
```

### 2단계: Context DB 초기화

`init.sql` 생성 후 DB 초기화:

```bash
cat > .claude/db/init.sql << 'SQLEOF'
-- Project Context DB Schema v1.1

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    end_time TEXT,
    duration_minutes INTEGER,
    location TEXT,
    summary TEXT,
    files_changed INTEGER DEFAULT 0,
    commits_made INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_context_category ON context(category);
CREATE INDEX IF NOT EXISTS idx_context_key ON context(key);

CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    description TEXT NOT NULL,
    reason TEXT,
    related_files TEXT,
    status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    priority INTEGER DEFAULT 3,
    status TEXT DEFAULT 'pending',
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS tool_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    tool_name TEXT NOT NULL,
    file_path TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_tool_usage_tool ON tool_usage(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_usage_file ON tool_usage(file_path);

CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    content_hash TEXT NOT NULL,
    keyword_tags TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    tool_name TEXT,
    error_type TEXT,
    file_path TEXT,
    resolution TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_errors_type ON errors(error_type);

CREATE TABLE IF NOT EXISTS commits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    hash TEXT NOT NULL,
    message TEXT NOT NULL,
    files_changed TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS live_context (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS db_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR REPLACE INTO db_meta (key, value) VALUES ('schema_version', '1.1');
INSERT OR REPLACE INTO db_meta (key, value) VALUES ('created_at', datetime('now', 'localtime'));
SQLEOF

sqlite3 .claude/db/context.db < .claude/db/init.sql
```

### 3단계: Helper CLI 복사

`helper.sh`를 생성한다. 기존 `project-local/db/helper.sh` 내용을 그대로 복사.
이미 이 저장소의 `project-local/db/helper.sh`에 완전한 구현이 있으므로 그대로 사용.

### 4단계: 에이전트 설치

`project-local/agents/` 디렉토리의 7개 파일을 `.claude/agents/`에 복사:
- `ralph.md` — 끈질긴 구현 에이전트
- `planner.md` — 계획 수립 에이전트
- `architect.md` — 설계 검토 에이전트
- `verifier.md` — 테스트 검증 에이전트
- `reviewer.md` — 코드 리뷰 에이전트
- `debugger.md` — 버그 원인 진단 에이전트
- `test-engineer.md` — 테스트 설계/작성 에이전트

### 5단계: Hooks 생성

`project-local/hooks/` 디렉토리의 6개 파일을 `.claude/hooks/`에 복사:
- `session-start.sh` — 세션 시작, DB 초기화, 미완료 태스크 표시
- `on-prompt.sh` — 매 턴 컨텍스트 주입, compaction 복구
- `post-tool-edit.sh` — 파일 편집 로깅
- `post-tool-bash.sh` — 에러 자동 감지
- `on-stop.sh` — 세션 통계 업데이트
- `ralph-persist.sh` — Ralph 모드 중단 차단

### 6단계: settings.json 생성

```bash
cat > .claude/settings.json << 'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0; bash \"$ROOT/.claude/hooks/session-start.sh\"'"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0; bash \"$ROOT/.claude/hooks/on-prompt.sh\"'"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0; bash \"$ROOT/.claude/hooks/post-tool-edit.sh\"'"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0; bash \"$ROOT/.claude/hooks/post-tool-bash.sh\"'"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0; bash \"$ROOT/.claude/hooks/on-stop.sh\"'"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0; bash \"$ROOT/.claude/hooks/ralph-persist.sh\"'"
          }
        ]
      }
    ]
  }
}
EOF
```

### 7단계: HUD / Context Monitor 설치

사용자에게 HUD 설치 위치를 확인:

```
HUD 설치 위치를 선택하세요:
(A) Global 설치 (권장) — 모든 프로젝트에서 동일 HUD 사용
(B) Project 설치 — 이 프로젝트에서만 사용
```

**참고**: Project statusLine은 Global을 완전 대체한다. Global에 이미 HUD가 설정되어 있으면 Project 설치 시 Global이 무시됨.

**(A) Global 설치:**
```bash
mkdir -p ~/.claude/scripts
# context-monitor.mjs → ~/.claude/scripts/context-monitor.mjs
```
`~/.claude/settings.json`에 statusLine 설정:
```json
{ "statusLine": { "type": "command", "command": "node ~/.claude/scripts/context-monitor.mjs", "padding": 2 } }
```

**(B) Project 설치:**
```bash
# context-monitor.mjs → .claude/scripts/context-monitor.mjs (이미 3단계에서 생성됨)
```
`.claude/settings.json`에 statusLine 설정:
```json
{ "statusLine": { "type": "command", "command": "node .claude/scripts/context-monitor.mjs", "padding": 2 } }
```

**이미 Global에 HUD가 있고 (A) 선택 시**: "기존 Global HUD를 시스템 HUD로 교체합니다" 확인 후 업데이트.

### 8단계: 기본 Commands 복사

`project-local/commands/` 내 5개 명령어를 `.claude/commands/`에 복사:
- `implement.md`, `commit.md`, `tellme.md`, `discover.md`, `reportdb.md`

### 9단계: CLAUDE.md 생성

프로젝트 루트에 `CLAUDE.md`가 없으면 템플릿 생성.
`project-local/CLAUDE.md`를 기반으로 COMMON 섹션은 그대로, PROJECT 섹션은 비워둔다.

### 10단계: .gitignore 업데이트

```bash
# .claude/db/context.db를 gitignore에 추가 (이미 없는 경우)
grep -q 'context.db' .gitignore 2>/dev/null || echo -e '\n# Claude Code Context DB\n.claude/db/context.db' >> .gitignore
```

## 완료 메시지

```
## 프로젝트 초기화 완료

생성된 파일:
- .claude/agents/ (7개 커스텀 에이전트)
- .claude/db/init.sql + context.db (Context DB)
- .claude/db/helper.sh (CLI 도구)
- .claude/hooks/ (6개 자동 실행 스크립트)
- .claude/commands/ (5개 커스텀 명령어: implement, commit, tellme, discover, reportdb)
- .claude/scripts/context-monitor.mjs (HUD + 컨텍스트 모니터)
- .claude/settings.json (Hook 등록)
- CLAUDE.md (프로젝트 가이드 — PROJECT 섹션 작성 필요)

다음 단계:
1. CLAUDE.md의 PROJECT 섹션을 프로젝트에 맞게 작성
2. 필요한 커스텀 명령어/훅 추가
3. 다음 세션부터 자동 추적 시작
```

## 주의사항

- 기존 `.claude/` 파일이 있으면 덮어쓰기 전 반드시 확인
- `context.db`는 `.gitignore`에 추가 (개인 작업 기록이므로)
- `init.sql`, `helper.sh`, hooks, commands는 git 추적 권장 (팀 공유)
