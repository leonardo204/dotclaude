-- Wander Project Context DB Schema
-- Version: 1.3

-- 작업 세션 기록
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    end_time TEXT,
    duration_minutes INTEGER,
    location TEXT,  -- 'home' / 'office' / 'unknown'
    summary TEXT,
    files_changed INTEGER DEFAULT 0,
    commits_made INTEGER DEFAULT 0
);

-- 설계 결정 이력
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    description TEXT NOT NULL,
    reason TEXT,
    related_files TEXT,  -- JSON array of file paths
    status TEXT DEFAULT 'active'  -- active, superseded, reverted
);

-- 도구 사용 로그 (discover 분석용)
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
CREATE INDEX IF NOT EXISTS idx_tool_usage_session ON tool_usage(session_id);

-- 에러/이슈 로그 (discover 패턴 분석용)
CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    tool_name TEXT,
    error_type TEXT,  -- build_fail, test_fail, conflict, ...
    file_path TEXT,
    resolution TEXT,  -- 어떻게 해결했는지
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_errors_type ON errors(error_type);

-- 커밋 기록 (discover 패턴 분석용)
CREATE TABLE IF NOT EXISTS commits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    hash TEXT NOT NULL,
    message TEXT NOT NULL,
    files_changed TEXT,  -- JSON array
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Live Context (compaction-safe key-value store)
CREATE TABLE IF NOT EXISTS live_context (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- DB 메타 정보
CREATE TABLE IF NOT EXISTS db_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR REPLACE INTO db_meta (key, value) VALUES ('schema_version', '1.3');
INSERT OR REPLACE INTO db_meta (key, value) VALUES ('created_at', datetime('now', 'localtime'));
