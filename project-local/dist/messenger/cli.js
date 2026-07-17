// src/messenger/cli.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { execFileSync } from "node:child_process";
import { join as join3 } from "node:path";
import { DatabaseSync } from "node:sqlite";

// src/messenger/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
var CONFIG_MODE = 384;
function homeDir() {
  return process.env.HOME || homedir();
}
function configPath(home = homeDir()) {
  return join(home, ".claude", "messenger.json");
}
function readConfig(path = configPath()) {
  if (!existsSync(path)) return null;
  let parsed = {};
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
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
  mkdirSync(dirname(path), { recursive: true });
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

// src/messenger/telegram.ts
import { appendFileSync, mkdirSync as mkdirSync2, renameSync, statSync } from "node:fs";
import { setDefaultAutoSelectFamily } from "node:net";
import { dirname as dirname2, join as join2 } from "node:path";
var LOG_MAX_BYTES = 256 * 1024;
var SEND_TIMEOUT_MS = 15e3;
function logPath(home = homeDir()) {
  return join2(home, ".claude", "messenger.log");
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
    mkdirSync2(dirname2(file), { recursive: true });
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
function findDb() {
  let projRoot = "";
  try {
    projRoot = readFileSync2(join3(process.cwd(), ".claude/.project_root"), "utf8").trim();
  } catch {
  }
  if (!projRoot) {
    try {
      projRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
    }
  }
  if (!projRoot) projRoot = ".";
  const db = join3(projRoot, ".claude/db/context.db");
  return existsSync2(db) ? db : null;
}
function formatEpoch(epoch, withDate) {
  const d = new Date(epoch * 1e3);
  const p = (n) => String(n).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  if (!withDate) return time;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
}
var nowEpoch = () => Math.floor(Date.now() / 1e3);
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
function checkScope(scope) {
  if (scope !== "project") return true;
  let projRoot = "";
  try {
    projRoot = readFileSync2(join3(process.cwd(), ".claude/.project_root"), "utf8").trim();
  } catch {
  }
  if (!projRoot) {
    try {
      projRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
    }
  }
  if (!projRoot) projRoot = ".";
  return existsSync2(join3(projRoot, ".claude/.messenger_enabled"));
}
function gatherFacts(dbPath) {
  const facts = { startTimeStr: "", elapsedSec: 0, filesCount: "0", resultLine: "" };
  let db;
  try {
    db = new DatabaseSync(dbPath);
    const startRow = db.prepare("SELECT COALESCE(value,'0') AS v FROM live_context WHERE key='messenger_prompt_time'").get();
    const startEpoch = Number(startRow?.v ?? 0) || 0;
    if (startEpoch > 0) {
      facts.startTimeStr = formatEpoch(startEpoch, false);
      facts.elapsedSec = nowEpoch() - startEpoch;
      const promptDt = formatEpoch(startEpoch, true);
      const cnt = db.prepare(
        `SELECT COUNT(DISTINCT file_path) AS n FROM tool_usage
           WHERE tool_name IN ('Edit','Write')
             AND file_path IS NOT NULL
             AND timestamp >= ?`
      ).get(promptDt);
      facts.filesCount = String(cnt?.n ?? 0);
    }
    const pick = (key) => {
      const row = db.prepare("SELECT value AS v FROM live_context WHERE key=? AND value != '' LIMIT 1").get(key);
      return row?.v ?? "";
    };
    let result = pick("current_task") || pick("key_findings") || pick("session_summary");
    if (!result) {
      const row = db.prepare(
        `SELECT GROUP_CONCAT(DISTINCT REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '/', '')), '')) AS v
           FROM (SELECT file_path FROM tool_usage
                 WHERE tool_name IN ('Edit','Write') AND file_path IS NOT NULL
                 ORDER BY timestamp DESC LIMIT 5)`
      ).get();
      const recent = row?.v ?? "";
      if (recent) result = `\uD3B8\uC9D1: ${recent}`;
    }
    result = result.split("\n")[0] ?? "";
    if (result.length > 80) result = `${result.slice(0, 77)}...`;
    facts.resultLine = result;
  } catch {
  } finally {
    try {
      db?.close();
    } catch {
    }
  }
  return facts;
}
async function cmdNotify() {
  const cfg = readConfig();
  if (!cfg) return 0;
  if (!cfg.bot_token || !cfg.chat_id) return 0;
  if (!cfg.enabled) return 0;
  const dedupFile = join3(homeDir(), ".claude", ".messenger_last_notify");
  const now = nowEpoch();
  try {
    const last = Number(readFileSync2(dedupFile, "utf8").trim()) || 0;
    if (now > 0 && last > 0 && now - last < 30) return 0;
  } catch {
  }
  try {
    writeFileSync2(dedupFile, `${now}
`);
  } catch {
  }
  const stdinData = await readStdinLine();
  let stopReason = "completed";
  if (stdinData) {
    try {
      const payload = JSON.parse(stdinData);
      if (typeof payload.reason === "string" && payload.reason) stopReason = payload.reason;
    } catch {
    }
  }
  const projectPath = process.cwd();
  const dbPath = findDb();
  const facts = dbPath ? gatherFacts(dbPath) : { startTimeStr: "", elapsedSec: 0, filesCount: "0", resultLine: "" };
  if (cfg.min_duration > 0 && facts.elapsedSec > 0 && facts.elapsedSec < cfg.min_duration) return 0;
  if (!checkScope(cfg.scope || "global")) return 0;
  const durationStr = formatDuration(facts.elapsedSec);
  const endTime = formatEpoch(nowEpoch(), false);
  const startTimeStr = facts.startTimeStr || endTime;
  const resultLine = facts.resultLine || "\uC791\uC5C5 \uC644\uB8CC";
  const message = `[dotclaude]
\uD504\uB85C\uC81D\uD2B8: ${projectPath}
\uC0C1\uD0DC: ${stopReason}
\uC2DC\uC791: ${startTimeStr}
\uC885\uB8CC: ${endTime}
\uC18C\uC694: ${durationStr}
\uD30C\uC77C: ${facts.filesCount}\uAC1C
\uACB0\uACFC: ${resultLine}`;
  await sendMessage(cfg.bot_token, cfg.chat_id, escapeHtml(message));
  return 0;
}
function cmdPromptTime() {
  const dbPath = findDb();
  if (!dbPath) return 0;
  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.prepare(
      "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('messenger_prompt_time', ?, datetime('now','localtime'))"
    ).run(String(nowEpoch()));
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
