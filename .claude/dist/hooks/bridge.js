// src/hooks/bridge.ts
import { existsSync as existsSync4 } from "node:fs";
import { join as join3, dirname as dirname2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/shared/db.ts
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
var __dirname = dirname(fileURLToPath(import.meta.url));
var ContextDB = class {
  db;
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
  }
  // === Init ===
  /**
   * init.sql 스키마를 실행하여 테이블을 초기화한다.
   * @param initSqlPath  init.sql의 절대 경로 (기본값: 패키지 내 db/init.sql)
   */
  initSchema(initSqlPath) {
    const sqlPath = initSqlPath ?? join(__dirname, "../../db/init.sql");
    const sql = readFileSync(sqlPath, "utf8");
    this.db.exec(sql);
  }
  // === 세션 ===
  /** 새 세션을 삽입하고 생성된 id를 반환한다. */
  sessionCreate() {
    const stmt = this.db.prepare(
      "INSERT INTO sessions (start_time) VALUES (datetime('now','localtime'))"
    );
    const result = stmt.run();
    return Number(result.lastInsertRowid);
  }
  /** 가장 최근 세션 id를 반환한다. */
  sessionCurrent() {
    const stmt = this.db.prepare(
      "SELECT id FROM sessions ORDER BY id DESC LIMIT 1"
    );
    const row = stmt.get();
    return row?.id ?? 0;
  }
  /** 특정 세션 정보를 반환한다. */
  sessionInfo(id) {
    const stmt = this.db.prepare(
      "SELECT * FROM sessions WHERE id = ?"
    );
    return stmt.get(id);
  }
  /** 특정 세션의 필드를 부분 업데이트한다. */
  sessionUpdate(id, data) {
    const fields = Object.keys(data);
    if (fields.length === 0) return;
    const setClauses = fields.map((f) => `${f} = ?`).join(", ");
    const values = fields.map((f) => data[f]);
    const stmt = this.db.prepare(
      `UPDATE sessions SET ${setClauses} WHERE id = ?`
    );
    stmt.run(...values, id);
  }
  // === Live Context ===
  /** live_context에 key-value를 설정(upsert)한다. */
  liveSet(key, value) {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))"
    );
    stmt.run(key, value);
  }
  /** live_context에서 key로 값을 조회한다. */
  liveGet(key) {
    const stmt = this.db.prepare(
      "SELECT value FROM live_context WHERE key = ?"
    );
    const row = stmt.get(key);
    return row?.value ?? null;
  }
  /**
   * live_context의 key에 value를 줄 단위로 추가한다.
   * 중복 줄은 건너뛰고 maxLines 초과분은 오래된 줄부터 제거한다.
   */
  liveAppend(key, value, maxLines = 20) {
    const existing = this.liveGet(key);
    if (existing !== null) {
      const lines = existing.split("\n");
      if (lines.includes(value)) {
        return;
      }
      const updated = [...lines, value].slice(-maxLines).join("\n");
      this.liveSet(key, updated);
    } else {
      this.liveSet(key, value);
    }
  }
  /** live_context 전체를 { key: value } 형태로 반환한다. */
  liveDump() {
    const stmt = this.db.prepare(
      "SELECT key, value FROM live_context ORDER BY key"
    );
    const rows = stmt.all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  /** live_context에서 key를 삭제한다. */
  liveClear() {
    this.db.exec("DELETE FROM live_context");
  }
  // === Context (key-value store) ===
  ctxGet(key) {
    const stmt = this.db.prepare(
      "SELECT value FROM context WHERE key = ? ORDER BY updated_at DESC LIMIT 1"
    );
    const row = stmt.get(key);
    return row?.value ?? null;
  }
  ctxSet(key, value, category = "general") {
    const stmt = this.db.prepare(
      "INSERT INTO context (key, value, category) VALUES (?, ?, ?)"
    );
    stmt.run(key, value, category);
  }
  ctxList(category) {
    if (category) {
      const stmt2 = this.db.prepare(
        "SELECT * FROM context WHERE category = ? ORDER BY updated_at DESC"
      );
      return stmt2.all(category);
    }
    const stmt = this.db.prepare(
      "SELECT * FROM context ORDER BY updated_at DESC"
    );
    return stmt.all();
  }
  // === Tasks ===
  /** 태스크를 추가하고 생성된 id를 반환한다. */
  taskAdd(description, priority = 3, category = "") {
    const stmt = this.db.prepare(
      "INSERT INTO tasks (description, priority, category) VALUES (?, ?, ?)"
    );
    const result = stmt.run(description, priority, category);
    return Number(result.lastInsertRowid);
  }
  /** 태스크 목록을 조회한다. status 미지정 시 'pending'. */
  taskList(status) {
    const s = status ?? "pending";
    if (s === "all") {
      const stmt2 = this.db.prepare(
        "SELECT * FROM tasks ORDER BY priority, created_at"
      );
      return stmt2.all();
    }
    const stmt = this.db.prepare(
      "SELECT * FROM tasks WHERE status = ? ORDER BY priority, created_at"
    );
    return stmt.all(s);
  }
  /** 태스크를 완료 처리한다. */
  taskDone(id) {
    const stmt = this.db.prepare(
      "UPDATE tasks SET status='done', completed_at=datetime('now','localtime') WHERE id = ?"
    );
    stmt.run(id);
  }
  /** 태스크 상태를 임의 값으로 업데이트한다. */
  taskUpdate(id, status) {
    const stmt = this.db.prepare(
      "UPDATE tasks SET status = ? WHERE id = ?"
    );
    stmt.run(status, id);
  }
  // === Decisions ===
  /** 결정을 기록하고 생성된 id를 반환한다. */
  decisionAdd(description, rationale, relatedFiles) {
    const stmt = this.db.prepare(
      "INSERT INTO decisions (description, reason, related_files) VALUES (?, ?, ?)"
    );
    const result = stmt.run(description, rationale ?? null, relatedFiles ?? null);
    return Number(result.lastInsertRowid);
  }
  /** 최근 결정 목록을 반환한다. */
  decisionList(limit = 10) {
    const stmt = this.db.prepare(
      "SELECT * FROM decisions ORDER BY id DESC LIMIT ?"
    );
    return stmt.all(limit);
  }
  // === Errors ===
  /** 에러를 현재 세션에 기록한다. */
  errorLog(errorType, filePath, resolution) {
    const sessionId = this.sessionCurrent();
    const stmt = this.db.prepare(
      "INSERT INTO errors (session_id, error_type, file_path, resolution) VALUES (?, ?, ?, ?)"
    );
    stmt.run(sessionId || null, errorType, filePath ?? null, resolution ?? null);
  }
  /** 최근 에러 목록을 반환한다. */
  errorList(limit = 10) {
    const stmt = this.db.prepare(
      "SELECT * FROM errors ORDER BY id DESC LIMIT ?"
    );
    return stmt.all(limit);
  }
  // === Commits ===
  commitLog(hash, message, filesJson) {
    const sessionId = this.sessionCurrent();
    const stmt = this.db.prepare(
      "INSERT INTO commits (session_id, hash, message, files_changed) VALUES (?, ?, ?, ?)"
    );
    stmt.run(sessionId || null, hash, message, filesJson ?? null);
  }
  // === Tool Usage ===
  /** 도구 사용 내역을 기록한다. */
  toolLog(sessionId, toolName, filePath) {
    const stmt = this.db.prepare(
      "INSERT INTO tool_usage (session_id, tool_name, file_path) VALUES (?, ?, ?)"
    );
    stmt.run(sessionId, toolName, filePath);
  }
  // === Agent Handoff ===
  /**
   * agent-task / agent-result / agent-context 에 해당.
   * prefix: '_task:', '_result:', '_ctx:'
   */
  agentTask(name, description) {
    this.liveSet(`_task:${name}`, description);
  }
  agentTaskGet(name) {
    return this.liveGet(`_task:${name}`);
  }
  agentResult(name, result) {
    this.liveSet(`_result:${name}`, result);
  }
  agentResultGet(name) {
    return this.liveGet(`_result:${name}`);
  }
  /**
   * agent-context: value가 있으면 설정, 없으면 조회.
   * helper.sh와 동일한 read/write 이중 동작을 TS API로는 두 메서드로 분리한다.
   */
  agentContext(key, value) {
    if (value !== void 0) {
      this.liveSet(`_ctx:${key}`, value);
      return null;
    }
    return this.liveGet(`_ctx:${key}`);
  }
  agentCleanup(name) {
    const stmt = this.db.prepare(
      "DELETE FROM live_context WHERE key = ? OR key = ?"
    );
    stmt.run(`_task:${name}`, `_result:${name}`);
  }
  // === Stats ===
  stats() {
    const count = (sql) => {
      const stmt = this.db.prepare(sql);
      const row = stmt.get();
      return row?.n ?? 0;
    };
    return {
      sessions: count("SELECT COUNT(*) AS n FROM sessions"),
      tasks: count("SELECT COUNT(*) AS n FROM tasks WHERE status='pending'"),
      decisions: count("SELECT COUNT(*) AS n FROM decisions"),
      errors: count("SELECT COUNT(*) AS n FROM errors"),
      tool_usage: count("SELECT COUNT(*) AS n FROM tool_usage"),
      live_context: count("SELECT COUNT(*) AS n FROM live_context")
    };
  }
  // === Raw Query ===
  query(sql) {
    const stmt = this.db.prepare(sql);
    return stmt.all();
  }
  /** private db 인스턴스에 exec을 직접 호출한다. */
  execRaw(sql) {
    this.db.exec(sql);
  }
  // === 전용 헬퍼 메서드 ===
  /** 특정 세션에서 편집된 고유 파일 수를 반환한다. */
  sessionEditCount(sessionId) {
    const stmt = this.db.prepare(
      "SELECT COUNT(DISTINCT file_path) AS n FROM tool_usage WHERE session_id = ?"
    );
    const row = stmt.get(sessionId);
    return row?.n ?? 0;
  }
  /** pending/in_progress 태스크 수를 반환한다. */
  pendingTaskCount() {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('pending','in_progress')"
    );
    const row = stmt.get();
    return row?.n ?? 0;
  }
  /** 특정 세션에서 최근 편집된 파일 경로 목록을 반환한다. */
  recentToolFiles(sessionId, limit = 10) {
    const stmt = this.db.prepare(
      "SELECT DISTINCT file_path FROM tool_usage WHERE session_id = ? ORDER BY id DESC LIMIT ?"
    );
    const rows = stmt.all(sessionId, limit);
    return rows.map((r) => r.file_path);
  }
  // === Lifecycle ===
  close() {
    this.db.close();
  }
};

// src/hooks/events/session-start.ts
import { readFileSync as readFileSync2, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join as join2, basename } from "node:path";
async function handleSessionStart({ projectRoot, db }) {
  const out = [];
  try {
    const projectRootFile = join2(projectRoot, ".claude/.project_root");
    writeFileSync(projectRootFile, projectRoot, "utf8");
  } catch {
  }
  const initSqlPath = join2(projectRoot, ".claude/db/init.sql");
  if (existsSync(initSqlPath)) {
    db.initSchema(initSqlPath);
  }
  let lastSessionTime = null;
  try {
    const rows = db.query(
      "SELECT start_time FROM sessions ORDER BY id DESC LIMIT 1"
    );
    if (rows.length > 0) {
      lastSessionTime = rows[0].start_time;
    }
  } catch {
  }
  const sessionId = db.sessionCreate();
  try {
    db.execRaw("DELETE FROM live_context WHERE key IN ('working_files', 'error_context')");
  } catch {
  }
  const globalMd = join2(process.env["HOME"] ?? "", ".claude/CLAUDE.md");
  if (existsSync(globalMd)) {
    try {
      const content = readFileSync2(globalMd, "utf8");
      const lines = content.split("\n");
      const rules = [];
      let inSection = false;
      for (const line of lines) {
        if (line.startsWith("## ")) inSection = true;
        if (line === "---") inSection = false;
        if (inSection && (line.startsWith("- **") || line.startsWith("**") || line.startsWith("### "))) {
          rules.push(line);
          if (rules.length >= 20) break;
        }
      }
      if (rules.length > 0) {
        db.liveSet("_rules", rules.join("\n"));
      }
    } catch {
    }
  }
  const projectMd = join2(projectRoot, "CLAUDE.md");
  if (existsSync(projectMd)) {
    try {
      const content = readFileSync2(projectMd, "utf8");
      const lines = content.split("\n");
      const proj = [];
      let inSection = false;
      for (const line of lines) {
        if (line.startsWith("## PROJECT")) inSection = true;
        if (inSection && line === "---") break;
        if (inSection) {
          proj.push(line);
          if (proj.length >= 30) break;
        }
      }
      if (proj.length > 0) {
        db.liveSet("_project_rules", proj.join("\n"));
      }
    } catch {
    }
  }
  let diffHours = 9999;
  if (lastSessionTime) {
    try {
      const lastTs = new Date(lastSessionTime).getTime();
      const nowTs = Date.now();
      diffHours = Math.floor((nowTs - lastTs) / 36e5);
    } catch {
      diffHours = 0;
    }
  }
  const now = /* @__PURE__ */ new Date();
  const nowStr = now.toISOString().replace("T", " ").slice(0, 19);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  out.push(`[checkin] Session #${sessionId} started: ${nowStr} (${weekday})`);
  if (diffHours >= 24) {
    out.push(`[checkin] Last session: ${lastSessionTime} (${diffHours}h ago - LONG BREAK)`);
    out.push("[checkin] Action needed: full briefing recommended");
    try {
      const pendingRows = db.query(
        "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('pending','in_progress')"
      );
      const pending = pendingRows[0]?.n ?? 0;
      if (pending > 0) {
        out.push(`[checkin] Pending tasks: ${pending}`);
        const taskRows = db.query(
          "SELECT '  - [' || status || '] ' || description AS line FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority LIMIT 5"
        );
        for (const r of taskRows) out.push(r.line);
      }
    } catch {
    }
  } else if (diffHours >= 4) {
    out.push(`[checkin] Last session: ${lastSessionTime} (${diffHours}h ago - moderate break)`);
    out.push("[checkin] Quick sync recommended");
  } else {
    out.push(`[checkin] Last session: ${lastSessionTime} (${diffHours}h ago - recent)`);
  }
  const commandsDir = join2(projectRoot, ".claude/commands");
  out.push("");
  out.push("[project] Available commands:");
  if (existsSync(commandsDir)) {
    try {
      const files = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const cmdName = basename(file, ".md");
        const cmdPath = join2(commandsDir, file);
        const firstLine = readFileSync2(cmdPath, "utf8").split("\n")[0] ?? "";
        out.push(`  /project:${cmdName.padEnd(10)} - ${firstLine}`);
      }
    } catch {
    }
  }
  process.stdout.write(out.join("\n") + "\n");
}

// src/hooks/events/prompt.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2, existsSync as existsSync2 } from "node:fs";
async function handlePrompt({ projectRoot, db }) {
  const ctxStatePath = `${projectRoot}/.claude/.ctx_state`;
  let ctxState = {};
  let ctxAlert = "none";
  let ctxCurrent = 0;
  if (existsSync2(ctxStatePath)) {
    try {
      const raw = readFileSync3(ctxStatePath, "utf8");
      ctxState = JSON.parse(raw);
      ctxAlert = ctxState.alert ?? "none";
      ctxCurrent = ctxState.current ?? 0;
    } catch {
      ctxAlert = "none";
    }
  }
  const sessionId = db.sessionCurrent();
  if (ctxAlert === "compacted") {
    const restoredAt = ctxState.restored_at;
    const updated = ctxState.updated;
    if (restoredAt && restoredAt === updated) {
      const newState2 = {
        current: ctxCurrent,
        previous: 0,
        peak: ctxCurrent,
        alert: "none",
        updated: (/* @__PURE__ */ new Date()).toISOString()
      };
      writeFileSync2(ctxStatePath, JSON.stringify(newState2));
      const sessionEdits = getSessionEdits(db, sessionId);
      const pendingTasks = getPendingCount(db);
      process.stdout.write(
        `[ctx] Session #${sessionId} | Edits: ${sessionEdits} files | Pending tasks: ${pendingTasks}
[rules] \uD55C\uAD6D\uC5B4 \xB7 verify \xB7 agent\u22653 \xB7 live-set \xB7 no-commit
`
      );
      return;
    }
    const out = [];
    out.push("[hook:on-prompt] DB \uC870\uD68C: compaction \uBCF5\uAD6C (\uCD5C\uB300 \uBAA8\uB4DC)");
    out.push("[ctx-restore] Compaction detected. Restoring full context:");
    try {
      const liveRows = db.query(
        "SELECT '  - ' || key || ': ' || value AS line FROM live_context ORDER BY key"
      );
      if (liveRows.length > 0) {
        for (const r of liveRows) out.push(r.line);
      } else {
        out.push("  (no live context saved)");
      }
    } catch {
      out.push("  (no live context saved)");
    }
    try {
      const decisions = db.query(
        "SELECT '  - ' || description AS line FROM decisions ORDER BY id DESC LIMIT 5"
      );
      if (decisions.length > 0) {
        out.push("[ctx-restore] Recent decisions:");
        for (const r of decisions) out.push(r.line);
      }
    } catch {
    }
    try {
      const pendingCount = getPendingCount(db);
      if (pendingCount > 0) {
        const tasks = db.query(
          "SELECT '  - [P' || priority || '][' || status || '] ' || description AS line FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority"
        );
        out.push(`[ctx-restore] Pending tasks (${pendingCount}):`);
        for (const r of tasks) out.push(r.line);
      }
    } catch {
    }
    try {
      const errors = db.query(
        "SELECT '  - ' || error_type || ': ' || COALESCE(file_path,'') || ' (' || timestamp || ')' AS line FROM errors ORDER BY id DESC LIMIT 3"
      );
      if (errors.length > 0) {
        out.push("[ctx-restore] Recent errors:");
        for (const r of errors) out.push(r.line);
      }
    } catch {
    }
    out.push("[ctx-restore] Review above and continue your work.");
    const restoreTs = (/* @__PURE__ */ new Date()).toISOString();
    const newState = {
      current: ctxCurrent,
      previous: 0,
      peak: ctxCurrent,
      alert: "none",
      restored_at: restoreTs,
      updated: updated ?? restoreTs
    };
    writeFileSync2(ctxStatePath, JSON.stringify(newState));
    process.stdout.write(out.join("\n") + "\n");
  } else if (ctxAlert === "high") {
    try {
      const files = db.recentToolFiles(sessionId, 20);
      if (files.length > 0) {
        db.liveSet("working_files", files.join("\n"));
      }
    } catch {
    }
    process.stdout.write(
      `[ctx-warn] Context at ${ctxCurrent}%. \uD575\uC2EC \uC0C1\uD0DC \uC790\uB3D9 \uC800\uC7A5 \uC644\uB8CC. live-set\uC73C\uB85C \uCD94\uAC00 \uC800\uC7A5 \uAD8C\uC7A5
`
    );
  } else {
    const sessionEdits = getSessionEdits(db, sessionId);
    const pendingTasks = getPendingCount(db);
    process.stdout.write(
      `[ctx] Session #${sessionId} | Edits: ${sessionEdits} files | Pending tasks: ${pendingTasks}
[rules] \uD55C\uAD6D\uC5B4 \xB7 verify \xB7 agent\u22653 \xB7 live-set \xB7 no-commit
`
    );
  }
}
function getSessionEdits(db, sessionId) {
  try {
    return db.sessionEditCount(sessionId);
  } catch {
    return 0;
  }
}
function getPendingCount(db) {
  try {
    return db.pendingTaskCount();
  } catch {
    return 0;
  }
}

// src/hooks/events/post-edit.ts
async function handlePostEdit({ projectRoot, db, stdinData }) {
  if (!stdinData) return;
  let input;
  try {
    input = JSON.parse(stdinData);
  } catch {
    return;
  }
  const filePath = input.tool_input?.file_path;
  if (!filePath) return;
  const relPath = filePath.startsWith(projectRoot + "/") ? filePath.slice(projectRoot.length + 1) : filePath;
  const sessionId = db.sessionCurrent();
  if (sessionId > 0) {
    db.toolLog(sessionId, "Edit", relPath);
  }
}

// src/hooks/events/post-bash.ts
function classifyError(output) {
  const lower = output.toLowerCase();
  if (/error|failed|fatal/.test(lower)) {
    if (/build|compile/.test(lower)) return "build_fail";
    if (/test/.test(lower)) return "test_fail";
    if (/conflict/.test(lower)) return "conflict";
    if (/permission/.test(lower)) return "permission";
    return "runtime_error";
  }
  return "";
}
function extractFile(output) {
  const match = output.match(/(?:^|[\s:])([^\s:]+\.[a-zA-Z]{1,10})(?:[\s:]|$)/);
  return match?.[1] ?? "";
}
async function handlePostBash({ db, stdinData }) {
  if (!stdinData) return;
  let input;
  try {
    input = JSON.parse(stdinData);
  } catch {
    return;
  }
  const combined = (input.stderr ?? "") + (input.stdout ?? "");
  if (!combined) return;
  const errType = classifyError(combined);
  if (!errType) return;
  const errFile = extractFile(combined);
  db.errorLog(errType, errFile || void 0);
  const errInfo = `${errType}: ${errFile || "unknown"}`;
  db.liveSet("error_context", errInfo);
}

// src/hooks/events/stop-session.ts
async function handleStopSession({ db }) {
  const sessionId = db.sessionCurrent();
  if (sessionId <= 0) return;
  let filesChanged = 0;
  try {
    filesChanged = db.sessionEditCount(sessionId);
  } catch {
  }
  const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
  try {
    db.sessionUpdate(sessionId, { end_time: now, files_changed: filesChanged });
  } catch {
  }
  try {
    const files = db.recentToolFiles(sessionId, 10);
    if (files.length > 0) {
      const fileList = files.join(", ");
      const summary = filesChanged > 10 ? `${filesChanged} files: ${fileList}, ... +${filesChanged - 10} more` : `${filesChanged} files: ${fileList}`;
      db.liveSet("session_summary", summary);
    }
  } catch {
  }
  process.stdout.write(`[hook:on-stop] DB \uC870\uD68C: \uC138\uC158 #${sessionId} \uD3B8\uC9D1 \uD30C\uC77C \uC218
`);
}

// src/hooks/events/stop-ralph.ts
import { readFileSync as readFileSync4, existsSync as existsSync3 } from "node:fs";
async function handleStopRalph({ projectRoot, stdinData }) {
  const ralphStatePath = `${projectRoot}/.claude/.ralph_state`;
  if (!existsSync3(ralphStatePath)) return;
  let hookInput = {};
  if (stdinData) {
    try {
      hookInput = JSON.parse(stdinData);
    } catch {
    }
  }
  if (hookInput.stop_hook_active === true) return;
  let ralphState = {};
  try {
    const raw = readFileSync4(ralphStatePath, "utf8");
    ralphState = JSON.parse(raw);
  } catch {
    return;
  }
  const active = ralphState.active === true;
  const status = ralphState.status ?? "unknown";
  if (active && status !== "completed") {
    const blockResponse = {
      decision: "block",
      reason: "prompt",
      systemMessage: "Ralph \uBAA8\uB4DC \uD65C\uC131: \uD0DC\uC2A4\uD06C \uBBF8\uC644\uB8CC \uC0C1\uD0DC\uC785\uB2C8\uB2E4. .claude/.ralph_state\uB97C \uD655\uC778\uD558\uACE0 \uC791\uC5C5\uC744 \uACC4\uC18D\uD558\uC138\uC694."
    };
    process.stdout.write(JSON.stringify(blockResponse, null, 2) + "\n");
  }
}

// src/hooks/bridge.ts
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    let resolved = false;
    const done = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => done(data.trim()));
    setTimeout(() => done(data.trim()), 50);
  });
}
function findProjectRoot() {
  if (process.env["PROJECT_ROOT"]) {
    return process.env["PROJECT_ROOT"];
  }
  const __filename = fileURLToPath2(import.meta.url);
  const __dirname2 = dirname2(__filename);
  let dir = __dirname2;
  for (let i = 0; i < 6; i++) {
    if (existsSync4(join3(dir, ".claude"))) {
      return dir;
    }
    const parent = dirname2(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
async function main() {
  const hookEvent = process.env["HOOK_EVENT"] ?? "";
  if (!hookEvent) {
    process.stderr.write("[bridge] HOOK_EVENT \uD658\uACBD\uBCC0\uC218\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.\n");
    process.exit(1);
  }
  const stdinData = await readStdin();
  const projectRoot = findProjectRoot();
  const dbPath = join3(projectRoot, ".claude/db/context.db");
  if (hookEvent === "stop-ralph") {
    await handleStopRalph({ projectRoot, stdinData });
    return;
  }
  let db = null;
  try {
    if (hookEvent === "session-start" || existsSync4(dbPath)) {
      db = new ContextDB(dbPath);
    }
  } catch (err) {
    process.stderr.write(`[bridge] DB \uC5F0\uACB0 \uC2E4\uD328: ${err}
`);
    return;
  }
  if (!db) return;
  try {
    switch (hookEvent) {
      case "session-start":
        await handleSessionStart({ projectRoot, db });
        break;
      case "prompt":
        await handlePrompt({ projectRoot, db });
        break;
      case "post-edit":
        await handlePostEdit({ projectRoot, db, stdinData });
        break;
      case "post-bash":
        await handlePostBash({ projectRoot, db, stdinData });
        break;
      case "stop-session":
        await handleStopSession({ db });
        break;
      default:
        process.stderr.write(`[bridge] \uC54C \uC218 \uC5C6\uB294 HOOK_EVENT: ${hookEvent}
`);
        break;
    }
  } finally {
    db.close();
  }
}
main().catch((err) => {
  process.stderr.write(`[bridge] \uCE58\uBA85\uC801 \uC624\uB958: ${err}
`);
  process.exit(1);
});
