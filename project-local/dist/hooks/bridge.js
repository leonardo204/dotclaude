// src/hooks/bridge.ts
import { existsSync as existsSync6 } from "node:fs";
import { join as join6, dirname as dirname5 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

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
    try {
      this.db.exec(sql);
    } catch {
    }
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

// src/hooks/stdin.ts
var SAFETY_TIMEOUT_MS = 1e4;
async function readStdin(stream = process.stdin, safetyTimeoutMs = SAFETY_TIMEOUT_MS) {
  if (stream.isTTY) return "";
  let data = "";
  let completed = false;
  const read = (async () => {
    try {
      stream.setEncoding("utf8");
      for await (const chunk of stream) {
        data += chunk;
      }
    } catch {
    } finally {
      completed = true;
    }
  })();
  let timer;
  const safety = new Promise((resolve) => {
    timer = setTimeout(resolve, safetyTimeoutMs);
  });
  try {
    await Promise.race([read, safety]);
  } finally {
    clearTimeout(timer);
  }
  if (!completed) {
    try {
      stream.destroy?.();
    } catch {
    }
  }
  return data.trim();
}

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
  } else if (diffHours >= 4) {
    out.push(`[checkin] Last session: ${lastSessionTime} (${diffHours}h ago - moderate break)`);
    out.push("[checkin] Quick sync recommended");
  } else {
    out.push(`[checkin] Last session: ${lastSessionTime} (${diffHours}h ago - recent)`);
  }
  try {
    const handoff = db.liveGet("session_handoff");
    if (handoff) {
      out.push("");
      out.push(handoff);
    }
  } catch {
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
function recordPromptTime(db) {
  try {
    db.liveSet("messenger_prompt_time", String(Math.floor(Date.now() / 1e3)));
  } catch {
  }
}
async function handlePrompt({ projectRoot, db }) {
  recordPromptTime(db);
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
      process.stdout.write(
        `[ctx] Session #${sessionId} | Edits: ${sessionEdits} files
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
    process.stdout.write(
      `[ctx] Session #${sessionId} | Edits: ${sessionEdits} files
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

// src/hooks/events/post-edit.ts
import { chmodSync } from "node:fs";
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
  const toolName = input.tool_name ?? "Edit";
  const sessionId = db.sessionCurrent();
  if (sessionId > 0) {
    db.toolLog(sessionId, toolName, relPath);
  }
  if (filePath.endsWith(".sh") && input.tool_name === "Write") {
    try {
      chmodSync(filePath, 493);
    } catch {
    }
  }
}

// src/hooks/error-classify.ts
var CATEGORY_RULES = [
  {
    category: "build_fail",
    patterns: [
      /\bbuild\s+fail(?:ed|ure|s)\b/i,
      /\bcompilation\s+(?:error|failed)\b/i,
      /\bcompile\s+error\b/i,
      /\berror\s+TS\d+\b/,
      // tsc: "error TS2304: Cannot find name"
      /\berror\[E\d+\]/
      // rustc: "error[E0433]"
    ]
  },
  {
    category: "test_fail",
    patterns: [
      // "0 tests failed"는 성공 출력이므로 앞에 숫자가 붙은 형태를 배제한다.
      /(?<!\d\s)\btests?\s+fail(?:ed|ing|ure|ures)\b/i,
      /(?<![\d.])(?!0+\b)\d+\s+(?:tests?|specs?|assertions?)\s+fail(?:ed|ing)\b/i,
      /\bfail(?:ed|ing)\s+tests?\b/i,
      /\bassertion\s+fail(?:ed|ure)\b/i
    ]
  },
  {
    category: "conflict",
    patterns: [
      /\bmerge\s+conflict\b/i,
      /^CONFLICT\s*\(/m,
      // git: "CONFLICT (content): Merge conflict in x"
      /\bautomatic\s+merge\s+failed\b/i,
      /\bfix\s+conflicts\b/i
    ]
  },
  {
    category: "permission",
    patterns: [
      // 구 분류기의 치명적 오류: /permission/ 단독 → permission_mode에 오탐.
      /\bpermission\s+denied\b/i,
      /\boperation\s+not\s+permitted\b/i,
      /\b(?:EACCES|EPERM)\b/
    ]
  }
];
var ERROR_SIGNATURES = [
  // --- 셸 / OS 레벨 ---
  /:\s*No such file or directory\b/i,
  /:\s*command not found\b/i,
  /\bpermission denied\b/i,
  /\boperation not permitted\b/i,
  /\b(?:EACCES|EPERM|ENOENT)\b/,
  /\bsegmentation fault\b/i,
  /\bbus error\b/i,
  /\bKilled:\s*\d+/,
  // macOS OOM/시그널: "Killed: 9"
  // --- 툴체인 ---
  /\bnpm ERR!/,
  /\berror\s+TS\d+\b/,
  /\berror\[E\d+\]/,
  // 라인 머리의 "fatal:" / "error:" (git, gcc, cargo 등)
  /(?:^|\n)\s*(?:fatal|error)(?:\[[^\]]+\])?:\s/i,
  // 대문자 ERROR: 는 강한 신호 (esbuild "src/app.ts:3:10: ERROR: ...")
  /\bERROR:\s/,
  // --- 빌드 / 테스트 / 머지 ---
  /\bbuild\s+fail(?:ed|ure|s)\b/i,
  /\bcompilation\s+(?:error|failed)\b/i,
  /(?<!\d\s)\btests?\s+fail(?:ed|ing|ure|ures)\b/i,
  /(?<![\d.])(?!0+\b)\d+\s+(?:tests?|specs?|assertions?)\s+fail(?:ed|ing)\b/i,
  /\bmerge\s+conflict\b/i,
  /^CONFLICT\s*\(/m,
  /\bautomatic\s+merge\s+failed\b/i
];
function looksLikeError(output) {
  return ERROR_SIGNATURES.some((re) => re.test(output));
}
function classifyError(output) {
  for (const { category, patterns } of CATEGORY_RULES) {
    if (patterns.some((re) => re.test(output))) return category;
  }
  return "runtime_error";
}
function parseExitCode(errorText) {
  const match = errorText.match(/^\s*exit code (\d+)/i);
  if (!match?.[1]) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}
function extractFile(output) {
  const match = output.match(/(?:^|[\s:])([^\s:]+\.[a-zA-Z]{1,10})(?:[\s:]|$)/);
  return match?.[1] ?? "";
}

// src/hooks/events/post-bash.ts
async function handlePostBash({ db, stdinData }) {
  if (!stdinData) return;
  let input;
  try {
    input = JSON.parse(stdinData);
  } catch {
    return;
  }
  const result = input.tool_response;
  const combined = (result?.stderr ?? "") + (result?.stdout ?? "");
  if (!combined) return;
  if (!looksLikeError(combined)) return;
  const errType = classifyError(combined);
  const errFile = extractFile(combined);
  try {
    db.errorLog(errType, errFile || void 0);
    const errInfo = `${errType}: ${errFile || "unknown"}`;
    db.liveSet("error_context", errInfo);
  } catch {
  }
}

// src/hooks/events/post-bash-failure.ts
async function handlePostBashFailure({
  db,
  stdinData
}) {
  if (!stdinData) return;
  let input;
  try {
    input = JSON.parse(stdinData);
  } catch {
    return;
  }
  if (input.is_interrupt === true) return;
  if (typeof input.error !== "string") return;
  const errorText = input.error;
  const errType = classifyError(errorText);
  const errFile = extractFile(errorText);
  const exitCode = parseExitCode(errorText);
  try {
    db.errorLog(errType, errFile || void 0);
    const suffix = exitCode !== null ? ` (exit ${exitCode})` : "";
    db.liveSet("error_context", `${errType}: ${errFile || "unknown"}${suffix}`);
  } catch {
  }
}

// src/messenger/notify.ts
import { existsSync as existsSync4, readFileSync as readFileSync5, writeFileSync as writeFileSync4 } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname as dirname4, join as join5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/messenger/config.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync4, writeFileSync as writeFileSync3, chmodSync as chmodSync2 } from "node:fs";
import { dirname as dirname2, join as join3 } from "node:path";
import { homedir } from "node:os";
function homeDir() {
  return process.env.HOME || homedir();
}
function configPath(home = homeDir()) {
  return join3(home, ".claude", "messenger.json");
}
function readConfig(path = configPath()) {
  if (!existsSync3(path)) return null;
  let parsed = {};
  try {
    parsed = JSON.parse(readFileSync4(path, "utf8"));
  } catch {
    parsed = {};
  }
  const c = parsed !== null && typeof parsed === "object" ? parsed : {};
  const minRaw = c.min_duration ? Number(c.min_duration) : 0;
  return {
    bot_token: c.bot_token ? String(c.bot_token) : "",
    chat_id: c.chat_id ? String(c.chat_id) : "",
    enabled: c.enabled === false ? false : true,
    min_duration: Number.isFinite(minRaw) ? minRaw : 0,
    scope: c.scope ? String(c.scope) : "global"
  };
}

// src/messenger/format.ts
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function bold(text) {
  return `<b>${escapeHtml(text)}</b>`;
}
function redact(text) {
  return text.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<REDACTED>").replace(/\b\d{8,}:[A-Za-z0-9_-]{20,}/g, "<REDACTED>");
}
function formatDuration(sec) {
  if (!Number.isFinite(sec)) return "1\uCD08 \uBBF8\uB9CC";
  const s = Math.floor(sec);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    return m > 0 ? `${h}\uC2DC\uAC04 ${m}\uBD84` : `${h}\uC2DC\uAC04`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest > 0 ? `${m}\uBD84 ${rest}\uCD08` : `${m}\uBD84`;
  }
  if (s > 0) return `${s}\uCD08`;
  return "1\uCD08 \uBBF8\uB9CC";
}

// src/messenger/telegram.ts
import { appendFileSync, mkdirSync as mkdirSync2, renameSync, statSync } from "node:fs";
import { setDefaultAutoSelectFamily } from "node:net";
import { dirname as dirname3, join as join4 } from "node:path";
var LOG_MAX_BYTES = 256 * 1024;
var SEND_TIMEOUT_MS = 15e3;
function logPath(home = homeDir()) {
  return join4(home, ".claude", "messenger.log");
}
var familyPolicyApplied = false;
function defaultFetch() {
  if (!familyPolicyApplied) {
    familyPolicyApplied = true;
    try {
      setDefaultAutoSelectFamily(false);
    } catch {
    }
  }
  return fetch;
}
function rotateIfNeeded(path) {
  try {
    if (statSync(path).size >= LOG_MAX_BYTES) {
      renameSync(path, `${path}.1`);
    }
  } catch {
  }
}
function logLine(message, file = logPath()) {
  try {
    mkdirSync2(dirname3(file), { recursive: true });
    rotateIfNeeded(file);
    const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${redact(message)}
`;
    appendFileSync(file, line, { mode: 384 });
  } catch {
  }
}
async function sendMessage(token, chatId, html, options = {}) {
  const f = options.fetchImpl ?? defaultFetch();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = new URLSearchParams({
    chat_id: chatId,
    text: html,
    parse_mode: "HTML"
  });
  let raw;
  let status = 0;
  try {
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? SEND_TIMEOUT_MS)
    });
    status = res.status;
    raw = await res.text();
  } catch (err) {
    logLine(`send failed (network): ${String(err)} url=${url}`, options.logFile);
    return { ok: false, description: "\uD30C\uC2F1 \uC2E4\uD328" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logLine(`send failed (unparseable response): HTTP ${status} body=${raw} url=${url}`, options.logFile);
    return { ok: false, description: "\uD30C\uC2F1 \uC2E4\uD328" };
  }
  const r = parsed !== null && typeof parsed === "object" ? parsed : {};
  if (r.ok) {
    return { ok: true, description: "" };
  }
  const description = typeof r.description === "string" && r.description ? r.description : "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958";
  logLine(`send failed: HTTP ${status} body=${raw} url=${url}`, options.logFile);
  return { ok: false, description };
}

// src/messenger/notify.ts
var TELEGRAM_LIMIT = 4096;
var SUMMARY_MAX = 700;
var HANDOFF_MAX = 600;
var STOP_SEND_TIMEOUT_MS = 4e3;
var GIT_TIMEOUT_MS = 1e3;
var COST_STALE_MS = 12e4;
var DEDUP_WINDOW_SEC = 30;
var nowEpoch = () => Math.floor(Date.now() / 1e3);
function formatEpoch(epoch, withDate) {
  const d = new Date(epoch * 1e3);
  const p = (n) => String(n).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  if (!withDate) return time;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
}
function localDate(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function clip(text, max) {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}\u2026`;
}
function summarize(text, max) {
  let t = text.replace(/```[\s\S]*?```/g, " ").replace(/```[\s\S]*$/g, " ");
  const paras = t.split(/\n\s*\n/).map((p) => p.trim());
  const prose = paras.find((p) => p && !/^[#>|\-*\d.]/.test(p)) ?? paras.find((p) => p) ?? "";
  t = prose.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  return clip(t, max);
}
function costCachePath(home) {
  return join5(home, ".claude", ".hud_cost_cache.json");
}
function spawnCostWorker(cwd, home) {
  try {
    const candidates = [
      join5(dirname4(fileURLToPath2(import.meta.url)), "../hud/cost.js"),
      join5(home, ".claude", "dist", "hud", "cost.js")
    ];
    const worker = candidates.find((p) => existsSync4(p));
    if (!worker) return;
    const child = spawn(process.execPath, [worker, cwd], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
  }
}
function loadCost(cwd, home = homeDir()) {
  let entry;
  try {
    const path = costCachePath(home);
    if (existsSync4(path)) {
      const map = JSON.parse(readFileSync5(path, "utf8"));
      entry = map[cwd];
    }
  } catch {
  }
  const stale = !entry || Date.now() - entry.ts > COST_STALE_MS || entry.date !== localDate();
  if (stale) spawnCostWorker(cwd, home);
  if (!entry) return null;
  return { total: entry.total, today: entry.date === localDate() ? entry.today : 0 };
}
function loadRateLimit(home = homeDir()) {
  try {
    const path = join5(home, ".claude", ".hud_cache");
    if (!existsSync4(path)) return null;
    const c = JSON.parse(readFileSync5(path, "utf8"));
    if (c._ok !== true || c._rateLimited === true) return null;
    const five = c.five_hour?.utilization;
    const seven = c.seven_day?.utilization;
    if (typeof five !== "number" || typeof seven !== "number") return null;
    return { fiveHour: five, sevenDay: seven };
  } catch {
    return null;
  }
}
function gitBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}
function pickLive(db, keys) {
  for (const k of keys) {
    try {
      const v = db.liveGet(k);
      if (v) return v;
    } catch {
    }
  }
  return "";
}
function gatherFacts({ db, projectRoot, stop, home = homeDir(), tag }) {
  const facts = {
    projectPath: projectRoot,
    branch: "",
    startTimeStr: "",
    endTimeStr: formatEpoch(nowEpoch(), false),
    elapsedSec: 0,
    filesCount: 0,
    summary: "",
    cost: null,
    handoff: "",
    errors: [],
    commits: [],
    backgroundTasks: [],
    rateLimit: null
  };
  if (tag) facts.tag = tag;
  facts.branch = gitBranch(projectRoot);
  facts.cost = loadCost(projectRoot, home);
  facts.rateLimit = loadRateLimit(home);
  if (typeof stop.last_assistant_message === "string") {
    facts.summary = summarize(stop.last_assistant_message, SUMMARY_MAX);
  }
  if (Array.isArray(stop.background_tasks)) {
    facts.backgroundTasks = stop.background_tasks;
  }
  if (!db) return facts;
  let sessionId = 0;
  try {
    sessionId = db.sessionCurrent();
  } catch {
  }
  let promptEpoch = 0;
  try {
    promptEpoch = Number(db.liveGet("messenger_prompt_time") ?? 0) || 0;
  } catch {
  }
  if (promptEpoch > 0) {
    facts.startTimeStr = formatEpoch(promptEpoch, false);
    facts.elapsedSec = nowEpoch() - promptEpoch;
    try {
      const promptDt = formatEpoch(promptEpoch, true);
      const rows = db.query(
        `SELECT COUNT(DISTINCT file_path) AS n FROM tool_usage
         WHERE tool_name IN ('Edit','Write') AND file_path IS NOT NULL
           AND timestamp >= '${promptDt}'`
      );
      facts.filesCount = rows[0]?.n ?? 0;
    } catch {
    }
  } else if (sessionId > 0) {
    try {
      facts.filesCount = db.sessionEditCount(sessionId);
    } catch {
    }
  }
  if (!facts.summary) {
    const fallback = pickLive(db, ["current_task", "key_findings", "session_summary"]);
    if (fallback) facts.summary = clip(fallback, SUMMARY_MAX);
  }
  try {
    const h = db.liveGet("session_handoff");
    if (h) facts.handoff = clip(h, HANDOFF_MAX);
  } catch {
  }
  if (sessionId > 0 && Number.isInteger(sessionId)) {
    try {
      const rows = db.query(
        `SELECT error_type, COALESCE(file_path,'') AS file_path FROM errors
         WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 3`
      );
      facts.errors = rows.map((r) => r.file_path ? `${r.error_type}: ${r.file_path}` : r.error_type);
    } catch {
    }
    try {
      const rows = db.query(
        `SELECT message FROM commits WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 5`
      );
      facts.commits = rows.map((r) => String(r.message).split("\n")[0] ?? "");
    } catch {
    }
  }
  return facts;
}
function balanceBold(html) {
  const open = (html.match(/<b>/g) ?? []).length;
  const close = (html.match(/<\/b>/g) ?? []).length;
  return open > close ? html + "</b>".repeat(open - close) : html;
}
function safeCut(text, budget) {
  let cut = budget;
  const amp = text.lastIndexOf("&", cut - 1);
  if (amp >= 0 && text.indexOf(";", amp) >= cut) cut = amp;
  const lt = text.lastIndexOf("<", cut - 1);
  if (lt >= 0 && text.indexOf(">", lt) >= cut) cut = lt;
  return Math.max(cut, 0);
}
function truncateHtml(text, limit = TELEGRAM_LIMIT) {
  if (text.length <= limit) return text;
  const marker = "\n\u2026 (\uC0DD\uB7B5)";
  const budget = limit - marker.length;
  let cut = text.lastIndexOf("\n", budget);
  if (cut <= 0) cut = safeCut(text, budget);
  return balanceBold(text.slice(0, cut)) + marker;
}
function buildNotifyMessage(facts) {
  const lines = [];
  const section = (title, body) => {
    if (body.length === 0) return;
    lines.push("");
    lines.push(bold(title));
    lines.push(...body);
  };
  lines.push(bold(`[dotclaude] ${facts.tag ?? "\uC138\uC158 \uC885\uB8CC"}`));
  const branch = facts.branch ? ` (${escapeHtml(facts.branch)})` : "";
  lines.push(`\uD504\uB85C\uC81D\uD2B8: ${escapeHtml(facts.projectPath)}${branch}`);
  const running = facts.backgroundTasks.filter((t) => t.status === "running");
  lines.push(
    running.length > 0 ? `\uC0C1\uD0DC: \uC751\uB2F5 \uC644\uB8CC \u2014 \uBC31\uADF8\uB77C\uC6B4\uB4DC ${running.length}\uAC74 \uC9C4\uD589 \uC911` : "\uC0C1\uD0DC: \uC751\uB2F5 \uC644\uB8CC"
  );
  const start = facts.startTimeStr || facts.endTimeStr;
  lines.push(`\uC2DC\uAC04: ${escapeHtml(start)} \u2192 ${escapeHtml(facts.endTimeStr)} (${escapeHtml(formatDuration(facts.elapsedSec))})`);
  lines.push(`\uD30C\uC77C: ${facts.filesCount}\uAC1C`);
  if (facts.cost) {
    lines.push(`\uBE44\uC6A9: \uC624\uB298 $${facts.cost.today.toFixed(2)} / \uB204\uC801 $${facts.cost.total.toFixed(2)}`);
  }
  if (facts.rateLimit) {
    lines.push(`\uD55C\uB3C4: 5\uC2DC\uAC04 ${facts.rateLimit.fiveHour}% \xB7 7\uC77C ${facts.rateLimit.sevenDay}%`);
  }
  section("\uC694\uC57D", facts.summary ? [escapeHtml(facts.summary)] : []);
  section(
    `\uBC31\uADF8\uB77C\uC6B4\uB4DC (${facts.backgroundTasks.length}\uAC74)`,
    facts.backgroundTasks.map((t) => {
      const kind = t.agent_type ? `${t.type}/${t.agent_type}` : t.type;
      return `- [${escapeHtml(t.status)}] ${escapeHtml(kind)} \u2014 ${escapeHtml(t.description)}`;
    })
  );
  section(
    `\uC5D0\uB7EC (${facts.errors.length}\uAC74)`,
    facts.errors.map((e) => `- ${escapeHtml(e)}`)
  );
  section(
    `\uCEE4\uBC0B (${facts.commits.length}\uAC74)`,
    facts.commits.map((c) => `- ${escapeHtml(c)}`)
  );
  section("\uD578\uB4DC\uC624\uD504", facts.handoff ? [escapeHtml(facts.handoff)] : []);
  return truncateHtml(lines.join("\n"));
}
function checkScope(scope, projectRoot) {
  if (scope !== "project") return true;
  return existsSync4(join5(projectRoot, ".claude", ".messenger_enabled"));
}
function dedupBlocked(file, now) {
  try {
    const last = Number(readFileSync5(file, "utf8").trim()) || 0;
    if (now > 0 && last > 0 && now - last < DEDUP_WINDOW_SEC) return true;
  } catch {
  }
  try {
    writeFileSync4(file, `${now}
`);
  } catch {
  }
  return false;
}
async function runStopNotify(opts) {
  const home = opts.home ?? homeDir();
  const cfg = opts.config !== void 0 ? opts.config : readConfig();
  if (!cfg) return "skipped";
  if (!cfg.bot_token || !cfg.chat_id) return "skipped";
  if (!cfg.enabled) return "skipped";
  const dedupFile = opts.dedupFile ?? join5(home, ".claude", ".messenger_last_notify");
  if (dedupBlocked(dedupFile, nowEpoch())) return "skipped";
  const gather = { db: opts.db, projectRoot: opts.projectRoot, stop: opts.stop, home };
  if (opts.tag !== void 0) gather.tag = opts.tag;
  const facts = gatherFacts(gather);
  if (cfg.min_duration > 0 && facts.elapsedSec > 0 && facts.elapsedSec < cfg.min_duration) {
    return "skipped";
  }
  if (!checkScope(cfg.scope || "global", opts.projectRoot)) return "skipped";
  const send = opts.sendImpl ?? sendMessage;
  let res;
  try {
    res = await send(cfg.bot_token, cfg.chat_id, buildNotifyMessage(facts), {
      timeoutMs: STOP_SEND_TIMEOUT_MS
    });
  } catch {
    return "failed";
  }
  return res.ok ? "sent" : "failed";
}

// src/hooks/events/stop-session.ts
function localTimestamp(date = /* @__PURE__ */ new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
async function handleStopSession({ db }) {
  const sessionId = db.sessionCurrent();
  if (sessionId <= 0) return;
  let filesChanged = 0;
  try {
    filesChanged = db.sessionEditCount(sessionId);
  } catch {
  }
  let durationMinutes;
  try {
    const session = db.sessionInfo(sessionId);
    if (session?.start_time) {
      const startMs = new Date(session.start_time).getTime();
      durationMinutes = Math.round((Date.now() - startMs) / 6e4);
    }
  } catch {
  }
  const now = localTimestamp();
  try {
    const updateData = {
      end_time: now,
      files_changed: filesChanged
    };
    if (durationMinutes !== void 0) {
      updateData.duration_minutes = durationMinutes;
    }
    db.sessionUpdate(sessionId, updateData);
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
  try {
    const parts = [];
    const files = db.recentToolFiles(sessionId, 8);
    if (filesChanged > 0 || files.length > 0) {
      const fileList = files.join(", ");
      parts.push(`  - \uD3B8\uC9D1: ${filesChanged} files${fileList ? ` (${fileList})` : ""}`);
    }
    const commitRows = db.query(
      `SELECT message FROM commits WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 5`
    );
    if (commitRows.length > 0) {
      const msgs = commitRows.map((r) => r.message.split("\n")[0]).join(" / ");
      parts.push(`  - \uCEE4\uBC0B: ${commitRows.length}\uAC74 \u2014 ${msgs}`);
    }
    const decisionRows = db.query(
      "SELECT description FROM decisions WHERE status='active' ORDER BY id DESC LIMIT 2"
    );
    if (decisionRows.length > 0) {
      parts.push(`  - \uCD5C\uADFC \uACB0\uC815: ${decisionRows.map((r) => r.description).join(" / ")}`);
    }
    if (parts.length > 0) {
      db.liveSet(
        "session_handoff",
        `[handoff] \uC9C1\uC804 \uC138\uC158 #${sessionId} \uC694\uC57D:
${parts.join("\n")}`
      );
    }
  } catch {
  }
  process.stderr.write(`[hook:on-stop] DB \uC870\uD68C: \uC138\uC158 #${sessionId} \uD3B8\uC9D1 \uD30C\uC77C \uC218
`);
}

// src/hooks/events/stop-ralph.ts
import { readFileSync as readFileSync6, existsSync as existsSync5, statSync as statSync2 } from "node:fs";
var RALPH_STALE_MS = 30 * 60 * 1e3;
function evaluateRalphBlock({
  projectRoot,
  stdinData
}) {
  const ralphStatePath = `${projectRoot}/.claude/.ralph_state`;
  if (!existsSync5(ralphStatePath)) return null;
  let hookInput = {};
  if (stdinData) {
    try {
      hookInput = JSON.parse(stdinData);
    } catch {
    }
  }
  if (hookInput.stop_hook_active === true) return null;
  let ralphState = {};
  try {
    const raw = readFileSync6(ralphStatePath, "utf8");
    ralphState = JSON.parse(raw);
  } catch {
    return null;
  }
  const active = ralphState.active === true;
  const status = ralphState.status ?? "unknown";
  try {
    const ageMs = Date.now() - statSync2(ralphStatePath).mtimeMs;
    if (ageMs > RALPH_STALE_MS) return null;
  } catch {
    return null;
  }
  if (active && status !== "completed") {
    return {
      decision: "block",
      reason: "prompt",
      systemMessage: "Ralph \uBAA8\uB4DC \uD65C\uC131: \uD0DC\uC2A4\uD06C \uBBF8\uC644\uB8CC \uC0C1\uD0DC\uC785\uB2C8\uB2E4. .claude/.ralph_state\uB97C \uD655\uC778\uD558\uACE0 \uC791\uC5C5\uC744 \uACC4\uC18D\uD558\uC138\uC694."
    };
  }
  return null;
}

// src/hooks/events/stop.ts
var NOTIFY_TIMEOUT_MS = 5e3;
async function withTimeout(p, ms) {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    if (typeof timer.unref === "function") timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve("timeout");
      }
    );
  });
}
function parseStop(stdinData) {
  if (!stdinData) return {};
  try {
    return JSON.parse(stdinData);
  } catch {
    return {};
  }
}
async function handleStop({
  projectRoot,
  db,
  stdinData,
  notify
}) {
  const stop = parseStop(stdinData);
  if (db) {
    try {
      await handleStopSession({ db });
    } catch (err) {
      process.stderr.write(`[hook:stop] \uC138\uC158 \uD1B5\uACC4 \uC2E4\uD328: ${String(err)}
`);
    }
  }
  let block = null;
  try {
    block = evaluateRalphBlock({ projectRoot, stdinData });
  } catch (err) {
    process.stderr.write(`[hook:stop] ralph \uD310\uC815 \uC2E4\uD328: ${String(err)}
`);
  }
  try {
    await withTimeout(
      runStopNotify({ db, projectRoot, stop, ...notify }),
      NOTIFY_TIMEOUT_MS
    );
  } catch (err) {
    process.stderr.write(`[hook:stop] \uC54C\uB9BC \uC2E4\uD328: ${String(err)}
`);
  }
  if (block) {
    process.stdout.write(JSON.stringify(block, null, 2) + "\n");
  }
}

// src/hooks/bridge.ts
function findProjectRoot() {
  if (process.env["PROJECT_ROOT"]) {
    return process.env["PROJECT_ROOT"];
  }
  const __filename = fileURLToPath3(import.meta.url);
  const __dirname2 = dirname5(__filename);
  let dir = __dirname2;
  for (let i = 0; i < 6; i++) {
    if (existsSync6(join6(dir, ".claude"))) {
      return dir;
    }
    const parent = dirname5(dir);
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
  const dbPath = join6(projectRoot, ".claude/db/context.db");
  let db = null;
  try {
    if (hookEvent === "session-start" || existsSync6(dbPath)) {
      db = new ContextDB(dbPath);
    }
  } catch (err) {
    process.stderr.write(`[bridge] DB \uC5F0\uACB0 \uC2E4\uD328: ${err}
`);
    db = null;
  }
  if (hookEvent === "stop") {
    try {
      await handleStop({ projectRoot, db, stdinData });
    } finally {
      db?.close();
    }
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
      case "post-bash-fail":
        await handlePostBashFailure({ projectRoot, db, stdinData });
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
