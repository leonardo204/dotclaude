// src/hud/statusline.ts
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync
} from "node:fs";
import { join, dirname } from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
var C = {
  red: "\x1B[31m",
  yellow: "\x1B[33m",
  green: "\x1B[32m",
  cyan: "\x1B[36m",
  dim: "\x1B[2m",
  bold: "\x1B[1m",
  reset: "\x1B[0m"
};
var HUD_CACHE_FILE = join(homedir(), ".claude", ".hud_cache");
var AGENT_CACHE_FILE = join(homedir(), ".claude", ".agent_cache");
var AGENT_CACHE_TTL = 5e3;
var STALE_SUBAGENT_MS = Number(process.env.DOTCLAUDE_STALE_SUBAGENT_MS) || 12e4;
function normalizeStdinLimit(x) {
  if (!x || x.used_percentage == null) return void 0;
  let resets_at;
  if (typeof x.resets_at === "number") {
    const ms = x.resets_at > 1e12 ? x.resets_at : x.resets_at * 1e3;
    resets_at = new Date(ms).toISOString();
  } else if (typeof x.resets_at === "string") {
    resets_at = x.resets_at;
  }
  return { utilization: x.used_percentage, resets_at };
}
async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = chunks.join("");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function getContextPercent(stdin) {
  const p = stdin.context_window?.used_percentage;
  if (typeof p === "number" && !Number.isNaN(p))
    return Math.min(100, Math.max(0, Math.round(p)));
  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) return 0;
  const u = stdin.context_window?.current_usage;
  const total = (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
  return Math.min(100, Math.round(total / size * 100));
}
function updateCtxState(cwd, percent) {
  const statePath = join(cwd, ".claude", ".ctx_state");
  let state = {
    current: 0,
    previous: 0,
    peak: 0,
    alert: "none",
    updated: ""
  };
  try {
    if (existsSync(statePath))
      state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
  }
  state.previous = state.current;
  state.current = percent;
  state.peak = Math.max(state.peak || 0, percent);
  state.updated = (/* @__PURE__ */ new Date()).toISOString();
  if (state.previous >= 70 && percent < 40) {
    state.alert = "compacted";
    state.peak = percent;
  } else if (percent >= 70) {
    state.alert = "high";
  } else if (state.alert !== "compacted") {
    state.alert = "none";
  }
  try {
    writeFileSync(statePath, JSON.stringify(state));
  } catch {
  }
  return state;
}
var COST_CACHE_FILE = join(homedir(), ".claude", ".hud_cost_cache.json");
var COST_STALE_MS = 8e3;
function localDate() {
  const d = /* @__PURE__ */ new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function spawnCostWorker(cwd) {
  try {
    const worker = join(dirname(fileURLToPath(import.meta.url)), "cost.js");
    if (!existsSync(worker)) return;
    const child = spawn(process.execPath, [worker, cwd], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
  }
}
function loadCost(cwd) {
  let entry;
  try {
    if (existsSync(COST_CACHE_FILE)) {
      const map = JSON.parse(readFileSync(COST_CACHE_FILE, "utf8"));
      entry = map[cwd];
    }
  } catch {
  }
  const stale = !entry || Date.now() - entry.ts > COST_STALE_MS || entry.date !== localDate();
  if (stale) spawnCostWorker(cwd);
  if (!entry) return null;
  const today = entry.date === localDate() ? entry.today : 0;
  return { total: entry.total, today };
}
function loadHudCache() {
  try {
    if (!existsSync(HUD_CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(HUD_CACHE_FILE, "utf8"));
    return data;
  } catch {
    return null;
  }
}
function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const totalMin = Math.floor(ms / 6e4);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d${rh}h` : `${d}d`;
}
function renderLimit(label, info) {
  if (!info || info.utilization == null) {
    return `${label}:${C.dim}--%${C.reset}`;
  }
  if (info.resets_at) {
    const resetTime = new Date(info.resets_at).getTime();
    if (resetTime <= Date.now()) {
      return `${label}:${C.dim}--%${C.reset}`;
    }
  }
  const raw = info.utilization;
  const pct = Math.round(raw >= 1 ? raw : raw * 100);
  const resetStr = info.resets_at ? formatDuration(new Date(info.resets_at).getTime() - Date.now()) : null;
  const color = pct >= 90 ? C.red : pct >= 70 ? C.yellow : C.green;
  const resetPart = resetStr ? `${C.dim}(${resetStr})${C.reset}` : "";
  return `${label}:${color}${pct}%${C.reset}${resetPart}`;
}
function shortenCwd(cwd) {
  const home = homedir();
  if (cwd.startsWith(home)) {
    cwd = "~" + cwd.slice(home.length);
  }
  const parts = cwd.split("/");
  if (parts.length > 4) {
    return "\u2026/" + parts.slice(-2).join("/");
  }
  return cwd;
}
function countSubagents(sessionId) {
  if (!sessionId) return { active: 0, total: 0 };
  try {
    if (existsSync(AGENT_CACHE_FILE)) {
      const mtime = statSync(AGENT_CACHE_FILE).mtimeMs;
      if (Date.now() - mtime < AGENT_CACHE_TTL) {
        const cached = JSON.parse(readFileSync(AGENT_CACHE_FILE, "utf8"));
        return { active: cached.active, total: cached.total };
      }
    }
  } catch {
  }
  const home = homedir();
  const projectsDir = join(home, ".claude", "projects");
  let result = { active: 0, total: 0 };
  try {
    if (!existsSync(projectsDir)) return result;
    for (const proj of readdirSync(projectsDir)) {
      const sessionDir = join(projectsDir, proj, sessionId, "subagents");
      if (existsSync(sessionDir)) {
        const transcripts = readdirSync(sessionDir).filter(
          (f) => f.startsWith("agent-") && f.endsWith(".jsonl")
        );
        let active = 0;
        let live = 0;
        const now = Date.now();
        for (const f of transcripts) {
          const fpath = join(sessionDir, f);
          let isStale = false;
          try {
            isStale = now - statSync(fpath).mtimeMs > STALE_SUBAGENT_MS;
          } catch {
          }
          try {
            const content = readFileSync(fpath, "utf8").trim();
            const lastLine = content.split("\n").pop() ?? "";
            const last = JSON.parse(lastLine);
            const done = Boolean(last?.message?.stop_reason);
            if (done) {
              live++;
            } else if (!isStale) {
              active++;
              live++;
            }
          } catch {
            if (!isStale) {
              active++;
              live++;
            }
          }
        }
        result = { active, total: live };
        break;
      }
    }
  } catch {
  }
  try {
    const cacheData = { ...result, ts: Date.now() };
    writeFileSync(AGENT_CACHE_FILE, JSON.stringify(cacheData));
  } catch {
  }
  return result;
}
function fmtUsd(n) {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}
function renderCost(c) {
  const color = c.total >= 200 ? C.red : c.total >= 50 ? C.yellow : C.green;
  const todayPart = c.today > 0 ? ` ${C.dim}(today ${fmtUsd(c.today)})${C.reset}` : "";
  return `${color}${fmtUsd(c.total)}${C.reset}${todayPart}`;
}
function renderContext(percent) {
  const color = percent >= 85 ? C.red : percent >= 70 ? C.yellow : C.green;
  const suffix = percent >= 90 ? " CRITICAL" : percent >= 80 ? " COMPRESS?" : "";
  return `ctx:${color}${percent}%${suffix}${C.reset}`;
}
var HUD_DISABLED_FILE = join(homedir(), ".claude", ".hud_disabled");
async function main() {
  try {
    if (existsSync(HUD_DISABLED_FILE)) return;
    const stdin = await readStdin();
    if (!stdin) return;
    const parts = [];
    const ver = stdin.version;
    if (ver) {
      parts.push(`${C.dim}[CC#${ver}]${C.reset}`);
    }
    const cwd = stdin.workspace?.current_dir ?? stdin.cwd ?? process.cwd();
    let branchName = "";
    try {
      branchName = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        encoding: "utf8",
        timeout: 2e3,
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
    }
    const branchPart = branchName ? ` ${C.dim}(${C.reset}${C.green}${branchName}${C.reset}${C.dim})${C.reset}` : "";
    parts.push(`${C.cyan}${shortenCwd(cwd)}${C.reset}${branchPart}`);
    const cost = loadCost(cwd);
    if (cost && cost.total > 0) {
      parts.push(renderCost(cost));
    }
    const sl = stdin.rate_limits;
    const slFive = normalizeStdinLimit(sl?.five_hour);
    const slSeven = normalizeStdinLimit(sl?.seven_day);
    const cache = slFive && slSeven ? null : loadHudCache();
    const limitParts = [];
    limitParts.push(renderLimit("5h", slFive ?? cache?.five_hour));
    limitParts.push(renderLimit("wk", slSeven ?? cache?.seven_day));
    if (cache && cache._ok === false) {
      const staleMinutes = cache._ts ? (Date.now() - cache._ts) / 6e4 : Infinity;
      if (staleMinutes > 10) limitParts.push(`${C.red}auth?${C.reset}`);
    }
    if (limitParts.length > 0) {
      parts.push(limitParts.join(" "));
    }
    const modelName = stdin.model?.display_name;
    if (modelName) {
      parts.push(`${C.bold}${modelName}${C.reset}`);
    }
    const percent = getContextPercent(stdin);
    updateCtxState(cwd, percent);
    parts.push(renderContext(percent));
    const { active } = countSubagents(stdin.session_id);
    const agentColor = active > 0 ? C.yellow : C.dim;
    parts.push(`${agentColor}agents:${active}${C.reset}`);
    console.log(parts.join(` ${C.dim}|${C.reset} `));
  } catch {
  }
}
main();
