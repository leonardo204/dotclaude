#!/usr/bin/env node
/**
 * Claude Code HUD - Statusline Script
 *
 * Displays: [CC#ver] | CWD | 5h:45%(3h42m) wk:12%(2d5h) | ctx:14% | agents:N
 *
 * Data sources:
 * - stdin JSON: version, workspace, context_window
 * - OAuth API: rate limits (5h / weekly)
 * - Subagent transcripts: active agent count
 *
 * Portable: copy .claude/scripts/ to any project.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

// ── ANSI Colors ──
const C = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

// ── Cache config ──
const CACHE_TTL_OK = 300_000; // 5min
const CACHE_TTL_FAIL = 60_000; // 60s
const CACHE_FILE = join(homedir(), ".claude", ".hud_cache");

// ── Stdin ──
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

// ── Context % ──
function getContextPercent(stdin) {
  const p = stdin.context_window?.used_percentage;
  if (typeof p === "number" && !Number.isNaN(p))
    return Math.min(100, Math.max(0, Math.round(p)));
  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) return 0;
  const u = stdin.context_window?.current_usage;
  const total =
    (u?.input_tokens ?? 0) +
    (u?.cache_creation_input_tokens ?? 0) +
    (u?.cache_read_input_tokens ?? 0);
  return Math.min(100, Math.round((total / size) * 100));
}

// ── State persistence (.claude/.ctx_state) ──
function updateCtxState(cwd, percent) {
  const statePath = join(cwd, ".claude", ".ctx_state");
  let state = {
    current: 0,
    previous: 0,
    peak: 0,
    alert: "none",
    updated: "",
  };
  try {
    if (existsSync(statePath))
      state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {}

  state.previous = state.current;
  state.current = percent;
  state.peak = Math.max(state.peak || 0, percent);
  state.updated = new Date().toISOString();

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
  } catch {}
  return state;
}

// ── OAuth credentials ──
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

function extractOAuth(entry) {
  const oauth = entry.claudeAiOauth || entry.oauthAccount || entry;
  if (oauth?.accessToken) {
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken || null,
      expiresAt: oauth.expiresAt || null,
    };
  }
  return null;
}

function refreshOAuthToken(refreshToken) {
  try {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${OAUTH_CLIENT_ID}`;
    const result = execSync(
      `curl -s -m 5 -X POST "https://console.anthropic.com/v1/oauth/token" -H "Content-Type: application/x-www-form-urlencoded" -d '${body}'`,
      { encoding: "utf8", timeout: 8000 }
    );
    const data = JSON.parse(result);
    if (data.access_token) {
      // Write back to file credentials if possible
      writeBackCredentials(data);
      return data.access_token;
    }
  } catch {}
  return null;
}

function writeBackCredentials(tokenData) {
  const credPath = join(homedir(), ".claude", ".credentials.json");
  try {
    if (!existsSync(credPath)) return;
    const creds = JSON.parse(readFileSync(credPath, "utf8"));
    const entries = Array.isArray(creds) ? creds : [creds];
    for (const entry of entries) {
      const target = entry.claudeAiOauth || entry.oauthAccount || entry;
      if (target?.accessToken) {
        target.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) target.refreshToken = tokenData.refresh_token;
        if (tokenData.expires_in) {
          target.expiresAt = Date.now() + tokenData.expires_in * 1000;
        }
        break;
      }
    }
    writeFileSync(credPath, JSON.stringify(creds, null, 2));
  } catch {}
}

function getOAuthToken() {
  let oauth = null;

  // 1) macOS Keychain
  if (process.platform === "darwin") {
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: "utf8", timeout: 3000 }
      ).trim();
      const creds = JSON.parse(raw);
      const entries = Array.isArray(creds) ? creds : [creds];
      for (const entry of entries) {
        oauth = extractOAuth(entry);
        if (oauth) break;
      }
    } catch {}
  }

  // 2) File-based credentials
  if (!oauth) {
    const credPaths = [
      join(homedir(), ".claude", ".credentials.json"),
      join(homedir(), ".claude", "credentials.json"),
    ];
    for (const p of credPaths) {
      try {
        if (!existsSync(p)) continue;
        const creds = JSON.parse(readFileSync(p, "utf8"));
        const entries = Array.isArray(creds) ? creds : [creds];
        for (const entry of entries) {
          oauth = extractOAuth(entry);
          if (oauth) break;
        }
        if (oauth) break;
      } catch {}
    }
  }

  if (!oauth) return null;

  // Check expiry and refresh if needed
  if (oauth.expiresAt && oauth.expiresAt <= Date.now() && oauth.refreshToken) {
    const newToken = refreshOAuthToken(oauth.refreshToken);
    if (newToken) return newToken;
  }

  return oauth.accessToken;
}

// ── Usage API with cache ──
function loadCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    // Rate-limited entries use their own backoff logic in fetchUsageSync
    if (data._rateLimited) return data;
    const age = Date.now() - (data._ts || 0);
    const ttl = data._ok ? CACHE_TTL_OK : CACHE_TTL_FAIL;
    if (age < ttl) return data;
  } catch {}
  return null;
}

function saveCache(data, ok) {
  try {
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({ ...data, _ts: Date.now(), _ok: ok })
    );
  } catch {}
}

function fetchUsageSync() {
  // Check cache first
  const cached = loadCache();
  if (cached) {
    // If rate-limited with backoff, serve stale data or skip
    if (cached._rateLimited) {
      const hasStaleData = !!(cached.five_hour || cached.seven_day);
      // No stale data + too many retries → reset cache and retry fresh
      if (!hasStaleData && (cached._rlCount || 0) >= 5) {
        try { unlinkSync(CACHE_FILE); } catch {}
        // fall through to API call below
      } else {
        const backoffMs =
          Math.min(120_000 * Math.pow(2, (cached._rlCount || 1) - 1), 600_000);
        if (Date.now() - (cached._ts || 0) < backoffMs) {
          return hasStaleData ? cached : { _rateLimited: true };
        }
      }
    } else {
      return cached;
    }
  }

  const token = getOAuthToken();
  if (!token) return null;

  try {
    const result = execSync(
      `curl -s -m 5 -H "Authorization: Bearer ${token}" -H "anthropic-beta: oauth-2025-04-20" "https://api.anthropic.com/api/oauth/usage"`,
      { encoding: "utf8", timeout: 8000 }
    );
    const data = JSON.parse(result);

    // Check for rate limit error
    if (data.error?.type === "rate_limit_error") {
      const rlCount = (cached?._rlCount || 0) + 1;
      saveCache(
        { ...(cached || {}), _rateLimited: true, _rlCount: rlCount },
        false
      );
      return cached?.five_hour || cached?.seven_day ? cached : { _rateLimited: true };
    }

    if (data.five_hour || data.seven_day) {
      saveCache({ ...data, _rateLimited: false, _rlCount: 0 }, true);
      return data;
    }
    // API error (auth failure etc.) — preserve stale data
    const stale = {};
    if (cached?.five_hour) stale.five_hour = cached.five_hour;
    if (cached?.seven_day) stale.seven_day = cached.seven_day;
    saveCache({ ...stale, _ok: false }, false);
    return stale.five_hour || stale.seven_day ? stale : null;
  } catch {
    // Network error — preserve stale data
    const stale = {};
    if (cached?.five_hour) stale.five_hour = cached.five_hour;
    if (cached?.seven_day) stale.seven_day = cached.seven_day;
    saveCache({ ...stale, _ok: false }, false);
    return stale.five_hour || stale.seven_day ? stale : null;
  }
}

// ── Format duration ──
function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d${rh}h` : `${d}d`;
}

// ── Rate limit rendering ──
function renderLimit(label, info) {
  if (!info || info.utilization == null) return null;

  // API returns utilization as 0-100 (e.g. 38.0 = 38%)
  const raw = info.utilization;
  const pct = Math.round(raw >= 1 ? raw : raw * 100);
  const resetStr = info.resets_at
    ? formatDuration(new Date(info.resets_at).getTime() - Date.now())
    : null;

  const color = pct >= 90 ? C.red : pct >= 70 ? C.yellow : C.green;
  const resetPart = resetStr ? `${C.dim}(${resetStr})${C.reset}` : "";

  return `${label}:${color}${pct}%${C.reset}${resetPart}`;
}

// ── CWD shortening ──
function shortenCwd(cwd) {
  const home = homedir();
  if (cwd.startsWith(home)) {
    cwd = "~" + cwd.slice(home.length);
  }
  // If still too long, keep last 2 segments
  const parts = cwd.split("/");
  if (parts.length > 4) {
    return "…/" + parts.slice(-2).join("/");
  }
  return cwd;
}

// ── Subagent count (active / total) ──
function countSubagents(sessionId) {
  if (!sessionId) return { active: 0, total: 0 };
  const home = homedir();
  const projectsDir = join(home, ".claude", "projects");
  try {
    if (!existsSync(projectsDir)) return { active: 0, total: 0 };
    for (const proj of readdirSync(projectsDir)) {
      const sessionDir = join(projectsDir, proj, sessionId, "subagents");
      if (existsSync(sessionDir)) {
        const transcripts = readdirSync(sessionDir).filter(
          (f) => f.startsWith("agent-") && f.endsWith(".jsonl")
        );
        let active = 0;
        for (const f of transcripts) {
          try {
            const content = readFileSync(join(sessionDir, f), "utf8").trim();
            const lastLine = content.split("\n").pop();
            const last = JSON.parse(lastLine);
            if (!last?.message?.stop_reason) active++;
          } catch {
            // If we can't read/parse, assume active
            active++;
          }
        }
        return { active, total: transcripts.length };
      }
    }
  } catch {}
  return { active: 0, total: 0 };
}

// ── Context % rendering ──
function renderContext(percent) {
  const color =
    percent >= 80 ? C.red : percent >= 60 ? C.yellow : C.green;
  const suffix =
    percent >= 85
      ? " CRITICAL"
      : percent >= 75
        ? " COMPRESS?"
        : "";
  return `ctx:${color}${percent}%${suffix}${C.reset}`;
}

// ── Main ──
async function main() {
  try {
    const stdin = await readStdin();
    if (!stdin) return;

    const parts = [];

    // 1. Version
    const ver = stdin.version;
    if (ver) {
      parts.push(`${C.dim}[CC#${ver}]${C.reset}`);
    }

    // 2. CWD
    const cwd =
      stdin.workspace?.current_dir || stdin.cwd || process.cwd();
    parts.push(`${C.cyan}${shortenCwd(cwd)}${C.reset}`);

    // 3. Rate limits (5h / weekly)
    const usage = fetchUsageSync();
    if (usage) {
      const limitParts = [];
      if (usage._rateLimited && !usage.five_hour && !usage.seven_day) {
        limitParts.push(`5h:${C.dim}--%${C.reset} wk:${C.dim}--%${C.reset}`);
      } else {
        const fiveH = renderLimit("5h", usage.five_hour);
        const weekly = renderLimit("wk", usage.seven_day);
        if (fiveH) limitParts.push(fiveH);
        if (weekly) limitParts.push(weekly);
      }
      if (limitParts.length > 0) {
        parts.push(limitParts.join(" "));
      }
    }

    // 4. Model
    const modelName = stdin.model?.display_name;
    if (modelName) {
      parts.push(`${C.bold}${modelName}${C.reset}`);
    }

    // 5. Context %
    const percent = getContextPercent(stdin);
    updateCtxState(cwd, percent);
    parts.push(renderContext(percent));

    // 6. Agent count (active only, always shown)
    const { active } = countSubagents(stdin.session_id);
    const agentColor = active > 0 ? C.yellow : C.dim;
    parts.push(`${agentColor}agents:${active}${C.reset}`);

    // Output
    console.log(parts.join(` ${C.dim}|${C.reset} `));
  } catch {
    // Never crash the statusline
  }
}

main();
