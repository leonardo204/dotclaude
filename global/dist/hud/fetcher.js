// src/hud/fetcher.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, unlinkSync } from "node:fs";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";

// src/shared/oauth.ts
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
var OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
function extractOAuth(entry) {
  const oauth = entry.claudeAiOauth || entry.oauthAccount || entry;
  if (oauth?.accessToken) {
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken ?? null,
      expiresAt: oauth.expiresAt ?? null
    };
  }
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
          target.expiresAt = Date.now() + tokenData.expires_in * 1e3;
        }
        break;
      }
    }
    const tmpPath = join(tmpdir(), `credentials-${randomBytes(6).toString("hex")}.json`);
    writeFileSync(tmpPath, JSON.stringify(creds, null, 2));
    renameSync(tmpPath, credPath);
  } catch {
  }
}
async function refreshOAuthToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID
    });
    const res = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(5e3)
    });
    const data = await res.json();
    if (data.access_token) {
      writeBackCredentials(data);
      return data.access_token;
    }
  } catch {
  }
  return null;
}
async function getOAuthToken() {
  let oauth = null;
  if (process.platform === "darwin") {
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: "utf8", timeout: 3e3 }
      ).trim();
      const creds = JSON.parse(raw);
      const entries = Array.isArray(creds) ? creds : [creds];
      for (const entry of entries) {
        oauth = extractOAuth(entry);
        if (oauth) break;
      }
    } catch {
    }
  }
  if (!oauth) {
    const credPaths = [
      join(homedir(), ".claude", ".credentials.json"),
      join(homedir(), ".claude", "credentials.json")
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
      } catch {
      }
    }
  }
  if (!oauth) return null;
  if (oauth.expiresAt && oauth.expiresAt <= Date.now() && oauth.refreshToken) {
    const newToken = await refreshOAuthToken(oauth.refreshToken);
    if (newToken) return newToken;
  }
  return oauth.accessToken;
}

// src/hud/fetcher.ts
var HUD_CACHE_FILE = join2(homedir2(), ".claude", ".hud_cache");
var PID_FILE = join2(homedir2(), ".claude", ".hud_fetcher.pid");
var FETCH_INTERVAL_MS = 15 * 60 * 1e3;
var MAX_LIFETIME_MS = 24 * 60 * 60 * 1e3;
var USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
var SIGNAL_COOLDOWN_MS = 60 * 1e3;
var _lastSignalFetch = 0;
function writePid() {
  try {
    writeFileSync2(PID_FILE, String(process.pid));
  } catch {
  }
}
function removePid() {
  try {
    if (existsSync2(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
  }
}
function isAlreadyRunning() {
  try {
    if (!existsSync2(PID_FILE)) return false;
    const pid = parseInt(readFileSync2(PID_FILE, "utf8").trim(), 10);
    if (isNaN(pid) || pid === process.pid) return false;
    try {
      process.kill(pid, 0);
      try {
        process.kill(pid, "SIGUSR1");
        console.log(`[fetcher] sent SIGUSR1 to running process (pid: ${pid})`);
      } catch {}
      return true;
    } catch {
      removePid();
      return false;
    }
  } catch {
    return false;
  }
}
function loadCache() {
  try {
    if (!existsSync2(HUD_CACHE_FILE)) return null;
    return JSON.parse(readFileSync2(HUD_CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}
function saveCache(data) {
  try {
    writeFileSync2(HUD_CACHE_FILE, JSON.stringify(data));
  } catch {
  }
}
async function fetchUsage() {
  const token = await getOAuthToken();
  if (!token) {
    const existing2 = loadCache();
    const stale = {
      _ts: Date.now(),
      _ok: false,
      ...existing2?.five_hour ? { five_hour: existing2.five_hour } : {},
      ...existing2?.seven_day ? { seven_day: existing2.seven_day } : {}
    };
    saveCache(stale);
    return;
  }
  const existing = loadCache();
  try {
    const res = await fetch(USAGE_API_URL, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20"
      },
      signal: AbortSignal.timeout(1e4)
    });
    const data = await res.json();
    if (data.error?.type === "rate_limit_error") {
      const rlCount = (existing?._rlCount ?? 0) + 1;
      saveCache({
        _ts: Date.now(),
        _ok: false,
        _rateLimited: true,
        _rlCount: rlCount,
        ...existing?.five_hour ? { five_hour: existing.five_hour } : {},
        ...existing?.seven_day ? { seven_day: existing.seven_day } : {}
      });
      console.error(`[fetcher] rate limited (count: ${rlCount})`);
      return;
    }
    if (data.five_hour || data.seven_day) {
      saveCache({
        _ts: Date.now(),
        _ok: true,
        _rateLimited: false,
        _rlCount: 0,
        ...data.five_hour ? { five_hour: data.five_hour } : {},
        ...data.seven_day ? { seven_day: data.seven_day } : {}
      });
      console.log(`[fetcher] cache updated at ${(/* @__PURE__ */ new Date()).toISOString()}`);
      return;
    }
    saveCache({
      _ts: Date.now(),
      _ok: false,
      ...existing?.five_hour ? { five_hour: existing.five_hour } : {},
      ...existing?.seven_day ? { seven_day: existing.seven_day } : {}
    });
    console.error("[fetcher] API returned unexpected response:", JSON.stringify(data));
  } catch (err) {
    saveCache({
      _ts: Date.now(),
      _ok: false,
      ...existing?.five_hour ? { five_hour: existing.five_hour } : {},
      ...existing?.seven_day ? { seven_day: existing.seven_day } : {}
    });
    console.error("[fetcher] network error:", err instanceof Error ? err.message : String(err));
  }
}
async function main() {
  if (isAlreadyRunning()) {
    console.log("[fetcher] already running, exiting");
    process.exit(0);
  }
  writePid();
  process.on("exit", removePid);
  process.on("SIGINT", () => {
    removePid();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    removePid();
    process.exit(0);
  });
  console.log(`[fetcher] started (pid: ${process.pid})`);
  process.on("SIGUSR1", () => {
    const now = Date.now();
    if (now - _lastSignalFetch < SIGNAL_COOLDOWN_MS) {
      console.log(`[fetcher] SIGUSR1 received but cooldown active (${Math.round((SIGNAL_COOLDOWN_MS - (now - _lastSignalFetch)) / 1e3)}s remaining)`);
      return;
    }
    _lastSignalFetch = now;
    console.log("[fetcher] SIGUSR1 received, fetching immediately");
    void fetchUsage();
  });
  await fetchUsage();
  _lastSignalFetch = Date.now();
  const interval = setInterval(() => {
    void fetchUsage();
  }, FETCH_INTERVAL_MS);
  setTimeout(() => {
    clearInterval(interval);
    removePid();
    console.log("[fetcher] max lifetime reached, exiting");
    process.exit(0);
  }, MAX_LIFETIME_MS);
}
main().catch((err) => {
  console.error("[fetcher] fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
