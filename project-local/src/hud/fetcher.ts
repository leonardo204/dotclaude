/**
 * HUD Background Fetcher — OAuth usage API를 백그라운드에서 주기적으로 호출
 *
 * SessionStart 훅에서 실행: node dist/hud/fetcher.js &
 *
 * 동작:
 * 1. PID 파일로 중복 실행 방지
 * 2. OAuth 토큰 획득
 * 3. usage API 호출 → ~/.claude/.hud_cache에 저장
 * 4. 15분마다 반복
 * 5. 24시간 후 자동 종료
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getOAuthToken } from "../shared/oauth.js";

// ── 상수 ──
const HUD_CACHE_FILE = join(homedir(), ".claude", ".hud_cache");
const PID_FILE = join(homedir(), ".claude", ".hud_fetcher.pid");
const FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15분
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24시간
const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";

// ── 캐시 파일 형식 ──
interface UsageInfo {
  utilization: number;
  resets_at?: string;
}

interface HudCache {
  _ts: number;
  _ok: boolean;
  _rateLimited?: boolean;
  _rlCount?: number;
  five_hour?: UsageInfo;
  seven_day?: UsageInfo;
}

// ── PID 파일 관리 ──
function writePid(): void {
  try {
    writeFileSync(PID_FILE, String(process.pid));
  } catch {
    // ignore
  }
}

function removePid(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function isAlreadyRunning(): boolean {
  try {
    if (!existsSync(PID_FILE)) return false;
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    if (isNaN(pid) || pid === process.pid) return false;
    // 프로세스가 살아있는지 확인
    try {
      process.kill(pid, 0); // signal 0: 프로세스 존재 여부만 확인
      return true; // 살아있음
    } catch {
      // ESRCH: 프로세스 없음 → 스테일 PID 파일
      removePid();
      return false;
    }
  } catch {
    return false;
  }
}

// ── 캐시 읽기/쓰기 ──
function loadCache(): HudCache | null {
  try {
    if (!existsSync(HUD_CACHE_FILE)) return null;
    return JSON.parse(readFileSync(HUD_CACHE_FILE, "utf8")) as HudCache;
  } catch {
    return null;
  }
}

function saveCache(data: Partial<HudCache>): void {
  try {
    writeFileSync(HUD_CACHE_FILE, JSON.stringify(data));
  } catch {
    // ignore
  }
}

// ── API 호출 ──
async function fetchUsage(): Promise<void> {
  const token = await getOAuthToken();
  if (!token) {
    // 토큰 없음 — 캐시에 오류 기록 (기존 데이터 보존)
    const existing = loadCache();
    const stale: HudCache = {
      _ts: Date.now(),
      _ok: false,
      ...(existing?.five_hour ? { five_hour: existing.five_hour } : {}),
      ...(existing?.seven_day ? { seven_day: existing.seven_day } : {}),
    };
    saveCache(stale);
    return;
  }

  const existing = loadCache();

  try {
    const res = await fetch(USAGE_API_URL, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json() as {
      error?: { type: string };
      five_hour?: UsageInfo;
      seven_day?: UsageInfo;
    };

    // rate limit 에러
    if (data.error?.type === "rate_limit_error") {
      const rlCount = (existing?._rlCount ?? 0) + 1;
      saveCache({
        _ts: Date.now(),
        _ok: false,
        _rateLimited: true,
        _rlCount: rlCount,
        ...(existing?.five_hour ? { five_hour: existing.five_hour } : {}),
        ...(existing?.seven_day ? { seven_day: existing.seven_day } : {}),
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
        ...(data.five_hour ? { five_hour: data.five_hour } : {}),
        ...(data.seven_day ? { seven_day: data.seven_day } : {}),
      });
      console.log(`[fetcher] cache updated at ${new Date().toISOString()}`);
      return;
    }

    // API 에러 (인증 실패 등) — 기존 데이터 보존
    saveCache({
      _ts: Date.now(),
      _ok: false,
      ...(existing?.five_hour ? { five_hour: existing.five_hour } : {}),
      ...(existing?.seven_day ? { seven_day: existing.seven_day } : {}),
    });
    console.error("[fetcher] API returned unexpected response:", JSON.stringify(data));
  } catch (err) {
    // 네트워크 에러 — 기존 데이터 보존
    saveCache({
      _ts: Date.now(),
      _ok: false,
      ...(existing?.five_hour ? { five_hour: existing.five_hour } : {}),
      ...(existing?.seven_day ? { seven_day: existing.seven_day } : {}),
    });
    console.error("[fetcher] network error:", err instanceof Error ? err.message : String(err));
  }
}

// ── Main ──
async function main(): Promise<void> {
  // 중복 실행 방지
  if (isAlreadyRunning()) {
    console.log("[fetcher] already running, exiting");
    process.exit(0);
  }

  writePid();

  // 종료 시 PID 파일 정리
  process.on("exit", removePid);
  process.on("SIGINT", () => { removePid(); process.exit(0); });
  process.on("SIGTERM", () => { removePid(); process.exit(0); });

  console.log(`[fetcher] started (pid: ${process.pid})`);

  // 즉시 첫 번째 fetch
  await fetchUsage();

  // 15분마다 반복
  const interval = setInterval(() => { void fetchUsage(); }, FETCH_INTERVAL_MS);

  // 2시간 후 자동 종료
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
