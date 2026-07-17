// src/messenger/cli.ts
import { existsSync as existsSync3, readFileSync as readFileSync4 } from "node:fs";
import { execFileSync as execFileSync2 } from "node:child_process";
import { join as join5 } from "node:path";

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
    try {
      const col = this.db.prepare(
        "SELECT COUNT(*) AS n FROM pragma_table_info('context') WHERE name='access_count'"
      ).get();
      if (col.n === 0) {
        this.db.exec("ALTER TABLE context ADD COLUMN last_access_ts TEXT");
        this.db.exec(
          "ALTER TABLE context ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0"
        );
        try {
          this.db.exec("INSERT INTO context_fts(context_fts) VALUES('rebuild')");
        } catch {
        }
      }
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
  // === Context (key-value store) ===
  ctxGet(key) {
    try {
      this.db.prepare(
        "UPDATE context SET access_count = access_count + 1, last_access_ts = datetime('now','localtime') WHERE key = ?"
      ).run(key);
    } catch {
    }
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
        "SELECT * FROM context WHERE category = ? ORDER BY access_count DESC, updated_at DESC"
      );
      return stmt2.all(category);
    }
    const stmt = this.db.prepare(
      "SELECT * FROM context ORDER BY access_count DESC, updated_at DESC"
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

// src/messenger/config.ts
import { existsSync, mkdirSync, readFileSync as readFileSync2, writeFileSync, chmodSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
import { homedir } from "node:os";
var CONFIG_MODE = 384;
function homeDir() {
  return process.env.HOME || homedir();
}
function configPath(home = homeDir()) {
  return join2(home, ".claude", "messenger.json");
}
function readConfig(path = configPath()) {
  if (!existsSync(path)) return null;
  let parsed = {};
  try {
    parsed = JSON.parse(readFileSync2(path, "utf8"));
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
function writeConfig(config, path = configPath()) {
  mkdirSync(dirname2(path), { recursive: true });
  const json = JSON.stringify(
    {
      bot_token: config.bot_token,
      chat_id: config.chat_id,
      enabled: config.enabled,
      min_duration: config.min_duration,
      scope: config.scope
    },
    null,
    2
  ) + "\n";
  writeFileSync(path, json, { mode: CONFIG_MODE });
  chmodSync(path, CONFIG_MODE);
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
function padByte(text, width) {
  const len = Buffer.byteLength(text, "utf8");
  return len >= width ? text : text + " ".repeat(width - len);
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

// src/messenger/notify.ts
import { existsSync as existsSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname as dirname4, join as join4 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/messenger/telegram.ts
import { appendFileSync, mkdirSync as mkdirSync2, renameSync, statSync } from "node:fs";
import { setDefaultAutoSelectFamily } from "node:net";
import { dirname as dirname3, join as join3 } from "node:path";
var LOG_MAX_BYTES = 256 * 1024;
var SEND_TIMEOUT_MS = 15e3;
function logPath(home = homeDir()) {
  return join3(home, ".claude", "messenger.log");
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
  } catch (err2) {
    logLine(`send failed (network): ${String(err2)} url=${url}`, options.logFile);
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
function costCachePath(home) {
  return join4(home, ".claude", ".hud_cost_cache.json");
}
function spawnCostWorker(cwd, home) {
  try {
    const candidates = [
      join4(dirname4(fileURLToPath2(import.meta.url)), "../hud/cost.js"),
      join4(home, ".claude", "dist", "hud", "cost.js")
    ];
    const worker = candidates.find((p) => existsSync2(p));
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
    if (existsSync2(path)) {
      const map = JSON.parse(readFileSync3(path, "utf8"));
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
    const path = join4(home, ".claude", ".hud_cache");
    if (!existsSync2(path)) return null;
    const c = JSON.parse(readFileSync3(path, "utf8"));
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
    facts.summary = clip(stop.last_assistant_message, SUMMARY_MAX);
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
  return existsSync2(join4(projectRoot, ".claude", ".messenger_enabled"));
}
function dedupBlocked(file, now) {
  try {
    const last = Number(readFileSync3(file, "utf8").trim()) || 0;
    if (now > 0 && last > 0 && now - last < DEDUP_WINDOW_SEC) return true;
  } catch {
  }
  try {
    writeFileSync2(file, `${now}
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
  const dedupFile = opts.dedupFile ?? join4(home, ".claude", ".messenger_last_notify");
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

// src/messenger/cli.ts
var RED = "\x1B[0;31m";
var GREEN = "\x1B[0;32m";
var YELLOW = "\x1B[1;33m";
var BLUE = "\x1B[0;34m";
var BOLD = "\x1B[1m";
var RESET = "\x1B[0m";
var out = (s) => void process.stdout.write(s);
var err = (s) => void process.stderr.write(s);
var info = (m) => out(`${BLUE}[info]${RESET}  ${m}
`);
var warn = (m) => out(`${YELLOW}[warn]${RESET}  ${m}
`);
var ok = (m) => out(`${GREEN}[ok]${RESET}    ${m}
`);
var error = (m) => err(`${RED}[error]${RESET} ${m}
`);
var CONFIG_FILE = () => configPath();
function showHelp() {
  out("\n");
  out(`${BOLD}messenger.sh${RESET} \u2014 Telegram \uBA54\uC2E0\uC800 \uC54C\uB9BC \uC2A4\uD06C\uB9BD\uD2B8
`);
  out("\n");
  out("\uC0AC\uC6A9\uBC95:\n");
  out("  messenger.sh config <bot_token> <chat_id>  \uBD07 \uD1A0\uD070\uACFC \uCC44\uD305 ID \uC124\uC815\n");
  out("  messenger.sh test                           \uD14C\uC2A4\uD2B8 \uBA54\uC2DC\uC9C0 \uC804\uC1A1\n");
  out("  messenger.sh on                             \uC54C\uB9BC \uD65C\uC131\uD654\n");
  out("  messenger.sh off                            \uC54C\uB9BC \uBE44\uD65C\uC131\uD654\n");
  out('  messenger.sh send "\uBA54\uC2DC\uC9C0"                  \uBA54\uC2DC\uC9C0 \uC804\uC1A1\n');
  out("  messenger.sh status                         \uD604\uC7AC \uC124\uC815 \uC0C1\uD0DC \uD45C\uC2DC\n");
  out("  messenger.sh notify                         \uC138\uC158 \uC885\uB8CC \uC54C\uB9BC (Stop hook \uC804\uC6A9)\n");
  out("  messenger.sh set min_duration <\uCD08>          \uCD5C\uC18C \uC54C\uB9BC \uC2DC\uAC04 \uC124\uC815\n");
  out("  messenger.sh set scope <global|project>     \uC54C\uB9BC \uBC94\uC704 \uC124\uC815\n");
  out("  messenger.sh get <key>                      \uC124\uC815\uAC12 \uC870\uD68C\n");
  out("\n");
  out(`\uC124\uC815 \uD30C\uC77C: ${CONFIG_FILE()}
`);
  out("\n");
  out("\uC608\uC2DC:\n");
  out("  messenger.sh config <BOT_TOKEN> <CHAT_ID>\n");
  out("  messenger.sh test\n");
  out('  messenger.sh send "\uBE4C\uB4DC \uC644\uB8CC!"\n');
  out("  messenger.sh set min_duration 300\n");
  out("  messenger.sh set scope project\n");
  out("\n");
}
function errorNoConfig() {
  error("\uC124\uC815 \uD30C\uC77C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
  error("\uBA3C\uC800 \uC124\uC815\uD558\uC138\uC694: messenger.sh config <bot_token> <chat_id>");
}
function cmdConfig(args) {
  if (args.length < 2) {
    error("\uC0AC\uC6A9\uBC95: messenger.sh config <bot_token> <chat_id>");
    return 1;
  }
  const [token, chat] = args;
  const existing = readConfig();
  const next = {
    bot_token: token,
    chat_id: chat,
    enabled: existing?.enabled ?? true,
    min_duration: existing?.min_duration ?? 0,
    scope: existing?.scope ?? "global"
  };
  writeConfig(next);
  ok(`\uC124\uC815 \uC800\uC7A5 \uC644\uB8CC: ${CONFIG_FILE()}`);
  info("\uAD8C\uD55C \uC124\uC815: chmod 600 (\uC18C\uC720\uC790\uB9CC \uC77D\uAE30/\uC4F0\uAE30)");
  info(`bot_token: ${token.slice(0, 10)}...`);
  info(`chat_id: ${chat}`);
  out("\n");
  info("\uD14C\uC2A4\uD2B8: messenger.sh test");
  return 0;
}
async function cmdTest() {
  const cfg = readConfig();
  if (!cfg) {
    errorNoConfig();
    return 1;
  }
  if (!cfg.bot_token || !cfg.chat_id) {
    error("bot_token \uB610\uB294 chat_id\uAC00 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    error("\uB2E4\uC2DC \uC124\uC815\uD558\uC138\uC694: messenger.sh config <bot_token> <chat_id>");
    return 1;
  }
  info("\uD14C\uC2A4\uD2B8 \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uC911...");
  const msg = "[dotclaude] \uD154\uB808\uADF8\uB7A8 \uC54C\uB9BC \uD14C\uC2A4\uD2B8 \uC131\uACF5! \u2705";
  const res = await sendMessage(cfg.bot_token, cfg.chat_id, escapeHtml(msg));
  if (res.ok) {
    ok("\uD14C\uC2A4\uD2B8 \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uC644\uB8CC");
    return 0;
  }
  error(`Telegram API \uC624\uB958: ${res.description}`);
  error("\uD14C\uC2A4\uD2B8 \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uC2E4\uD328");
  return 1;
}
function cmdToggle(enabled) {
  const cfg = readConfig();
  if (!cfg) {
    errorNoConfig();
    return 1;
  }
  writeConfig({ ...cfg, enabled });
  ok(enabled ? "\uC54C\uB9BC \uD65C\uC131\uD654\uB428" : "\uC54C\uB9BC \uBE44\uD65C\uC131\uD654\uB428");
  return 0;
}
async function cmdSend(args) {
  if (args.length < 1) {
    error('\uC0AC\uC6A9\uBC95: messenger.sh send "\uBA54\uC2DC\uC9C0"');
    return 1;
  }
  const message = args[0];
  const cfg = readConfig();
  if (!cfg) {
    info("Telegram \uC54C\uB9BC \uBBF8\uC124\uC815 \u2014 \uC804\uC1A1 \uC2A4\uD0B5");
    info("\uC124\uC815\uD558\uB824\uBA74: messenger.sh config <bot_token> <chat_id>");
    return 0;
  }
  if (!cfg.bot_token || !cfg.chat_id) {
    info("bot_token \uB610\uB294 chat_id\uAC00 \uBE44\uC5B4 \uC788\uC74C \u2014 \uC804\uC1A1 \uC2A4\uD0B5");
    return 0;
  }
  if (!cfg.enabled) {
    info("\uC54C\uB9BC \uBE44\uD65C\uC131\uD654 \uC0C1\uD0DC \u2014 \uC804\uC1A1 \uC2A4\uD0B5 (\uD65C\uC131\uD654: messenger.sh on)");
    return 0;
  }
  const res = await sendMessage(cfg.bot_token, cfg.chat_id, escapeHtml(message));
  if (res.ok) {
    ok("\uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uC644\uB8CC");
    return 0;
  }
  error(`Telegram API \uC624\uB958: ${res.description}`);
  error("\uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uC2E4\uD328");
  return 1;
}
function cmdSet(args) {
  if (args.length < 2) {
    error("\uC0AC\uC6A9\uBC95: messenger.sh set <min_duration|scope> <\uAC12>");
    return 1;
  }
  const [key, value] = args;
  const cfg = readConfig();
  if (!cfg) {
    errorNoConfig();
    return 1;
  }
  switch (key) {
    case "min_duration": {
      if (!/^[0-9]+$/.test(value)) {
        error("min_duration \uC740 \uC815\uC218(\uCD08)\uC5EC\uC57C \uD569\uB2C8\uB2E4. \uC608: messenger.sh set min_duration 300");
        return 1;
      }
      writeConfig({ ...cfg, min_duration: Number(value) });
      const human = formatDuration(Number(value));
      ok(`\uCD5C\uC18C \uC54C\uB9BC \uC2DC\uAC04 \uC124\uC815: ${value}\uCD08 (${human}) \u2014 \uC774 \uC2DC\uAC04 \uBBF8\uB9CC \uC791\uC5C5\uC740 \uC54C\uB9BC \uC2A4\uD0B5`);
      return 0;
    }
    case "scope": {
      if (value !== "global" && value !== "project") {
        error("scope \uB294 'global' \uB610\uB294 'project' \uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.");
        return 1;
      }
      writeConfig({ ...cfg, scope: value });
      ok(`\uC54C\uB9BC \uBC94\uC704 \uC124\uC815: ${value}`);
      if (value === "project") {
        info("\uD504\uB85C\uC81D\uD2B8\uBCC4 \uD65C\uC131\uD654: \uD574\uB2F9 \uD504\uB85C\uC81D\uD2B8\uC5D0\uC11C /dotclaude-messenger \uC2E4\uD589 \uD6C4 \uBA54\uB274 4\uBC88 \uC120\uD0DD");
      }
      return 0;
    }
    default:
      error(`\uC54C \uC218 \uC5C6\uB294 \uC124\uC815 \uD0A4: ${key} (\uC0AC\uC6A9 \uAC00\uB2A5: min_duration, scope)`);
      return 1;
  }
}
function cmdGet(args) {
  if (args.length < 1) {
    error("\uC0AC\uC6A9\uBC95: messenger.sh get <key>");
    return 1;
  }
  const key = args[0];
  const cfg = readConfig();
  if (!cfg) {
    out("\n");
    return 0;
  }
  switch (key) {
    case "bot_token":
      out(`${cfg.bot_token}
`);
      return 0;
    case "chat_id":
      out(`${cfg.chat_id}
`);
      return 0;
    case "enabled":
      out(`${cfg.enabled ? "true" : "false"}
`);
      return 0;
    case "min_duration":
      out(`${cfg.min_duration}
`);
      return 0;
    case "scope":
      out(`${cfg.scope}
`);
      return 0;
    default:
      error(`\uC54C \uC218 \uC5C6\uB294 \uD0A4: ${key} (\uC0AC\uC6A9 \uAC00\uB2A5: bot_token, chat_id, enabled, min_duration, scope)`);
      return 1;
  }
}
function cmdStatus() {
  out("\n");
  out(`${BOLD}=== Telegram \uBA54\uC2E0\uC800 \uC124\uC815 \uC0C1\uD0DC ===${RESET}
`);
  out("\n");
  const cfg = readConfig();
  if (!cfg) {
    warn(`\uC124\uC815 \uD30C\uC77C \uC5C6\uC74C: ${CONFIG_FILE()}`);
    out("\n");
    info("\uC124\uC815\uD558\uB824\uBA74: messenger.sh config <bot_token> <chat_id>");
    return 0;
  }
  const maskedToken = cfg.bot_token ? `${cfg.bot_token.slice(0, 10)}...(\uB9C8\uC2A4\uD0B9\uB428)` : "(\uBE44\uC5B4\uC788\uC74C)";
  out(`  ${padByte("bot_token:", 14)} ${maskedToken}
`);
  out(`  ${padByte("chat_id:", 14)} ${cfg.chat_id || "'(\uBE44\uC5B4\uC788\uC74C)'"}
`);
  out(`  ${padByte("enabled:", 14)} `);
  out(cfg.enabled ? `${GREEN}\uD65C\uC131\uD654${RESET}
` : `${YELLOW}\uBE44\uD65C\uC131\uD654${RESET}
`);
  if (cfg.min_duration > 0) {
    out(`  ${padByte("min_duration:", 14)} ${cfg.min_duration}\uCD08 (${formatDuration(cfg.min_duration)})
`);
  } else {
    out(`  ${padByte("min_duration:", 14)} \uC81C\uD55C \uC5C6\uC74C
`);
  }
  out(`  ${padByte("scope:", 14)} ${cfg.scope || "global"}
`);
  out(`  ${padByte("\uC124\uC815 \uD30C\uC77C:", 14)} ${CONFIG_FILE()}
`);
  out("\n");
  return 0;
}
function findProjectRoot() {
  let projRoot = "";
  try {
    projRoot = readFileSync4(join5(process.cwd(), ".claude/.project_root"), "utf8").trim();
  } catch {
  }
  if (!projRoot) {
    try {
      projRoot = execFileSync2("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
    }
  }
  return projRoot || ".";
}
function findDb(projRoot = findProjectRoot()) {
  const db = join5(projRoot, ".claude/db/context.db");
  return existsSync3(db) ? db : null;
}
async function readStdinLine(timeoutMs = 1e3) {
  const stdin = process.stdin;
  if (stdin.isTTY) return "";
  return await new Promise((resolve) => {
    let data = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.removeAllListeners("data");
      stdin.removeAllListeners("end");
      stdin.removeAllListeners("error");
      try {
        stdin.pause();
      } catch {
      }
      resolve(data.split("\n")[0] ?? "");
    };
    const timer = setTimeout(finish, timeoutMs);
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n")) finish();
    });
    stdin.on("end", finish);
    stdin.on("error", finish);
  });
}
async function cmdNotify() {
  const stdinData = await readStdinLine();
  const projRoot = findProjectRoot();
  const dbPath = findDb(projRoot);
  let db = null;
  try {
    if (dbPath) db = new ContextDB(dbPath);
  } catch {
  }
  let stop = {};
  if (stdinData) {
    try {
      stop = JSON.parse(stdinData);
    } catch {
    }
  }
  try {
    await runStopNotify({ db, projectRoot: projRoot, stop });
  } finally {
    try {
      db?.close();
    } catch {
    }
  }
  return 0;
}
function cmdPromptTime() {
  const dbPath = findDb();
  if (!dbPath) return 0;
  let db = null;
  try {
    db = new ContextDB(dbPath);
    db.liveSet("messenger_prompt_time", String(nowEpoch()));
  } catch {
  } finally {
    try {
      db?.close();
    } catch {
    }
  }
  return 0;
}
async function main(argv) {
  const [subcommand, ...args] = argv;
  switch (subcommand) {
    case "config":
      return cmdConfig(args);
    case "test":
      return await cmdTest();
    case "on":
      return cmdToggle(true);
    case "off":
      return cmdToggle(false);
    case "send":
      return await cmdSend(args);
    case "status":
      return cmdStatus();
    case "notify":
      return await cmdNotify();
    case "set":
      return cmdSet(args);
    case "get":
      return cmdGet(args);
    case "prompt-time":
      return cmdPromptTime();
    case void 0:
    case "":
    case "-h":
    case "--help":
    case "help":
      showHelp();
      return 0;
    default:
      error(`\uC54C \uC218 \uC5C6\uB294 \uC11C\uBE0C\uCEE4\uB9E8\uB4DC: ${subcommand}`);
      showHelp();
      return 1;
  }
}
process.exitCode = await main(process.argv.slice(2));
export {
  main
};
