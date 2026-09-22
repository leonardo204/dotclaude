/**
 * HUD Background Fetcher — OAuth usage API를 백그라운드에서 주기적으로 호출
 *
 * SessionStart/UserPromptSubmit 훅에서 실행.
 *
 * 동작:
 * 1. .hud_disabled 플래그 확인 → 있으면 즉시 종료
 * 2. stdio를 분리한 detached 자식으로 자기 자신을 재스폰 (부모는 즉시 종료)
 * 3. PID 파일로 중복 실행 방지
 * 4. OAuth 토큰 획득
 * 5. usage API 호출 → ~/.claude/.hud_cache에 저장
 * 6. 15분마다 반복
 * 7. 24시간 후 자동 종료
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, fstatSync, ftruncateSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getOAuthToken } from "../shared/oauth.js";

// ── 상수 ──
const HUD_CACHE_FILE = join(homedir(), ".claude", ".hud_cache");
const PID_FILE = join(homedir(), ".claude", ".hud_fetcher.pid");
const HUD_DISABLED_FILE = join(homedir(), ".claude", ".hud_disabled");
const LOG_FILE = join(homedir(), ".claude", ".hud_fetcher.log");
const DAEMON_ENV = "HUD_FETCHER_DAEMON";
const DAEMON_ARG = "--hud-fetcher-daemon";
const LOG_MAX_BYTES = 64 * 1024;
const FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15분
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24시간
const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
var SIGNAL_COOLDOWN_MS = 60 * 1e3;
var _lastSignalFetch = 0;

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

// ── 유효성 검사 ──
// resets_at이 과거면 데이터는 이미 만료된 것. fetcher가 새 값을 얻을 때까지
// 그 값을 보존하는 것은 statusline에 오래된 %를 계속 보여주므로 오해를 유발함.
function isUsageInfoFresh(info: UsageInfo | undefined): boolean {
  if (!info) return false;
  if (!info.resets_at) return true;
  return new Date(info.resets_at).getTime() > Date.now();
}

// ── HUD 비활성 플래그 ──
// statusline.ts와 동일한 플래그를 본다. HUD를 끈 상태에서 데몬만 계속 뜨면
// 훅 비용만 남고 얻는 것이 없다.
function isHudDisabled(): boolean {
  try {
    return existsSync(HUD_DISABLED_FILE);
  } catch {
    return false;
  }
}

// 이미 떠 있는 데몬을 멈춘다.
// 새 기동을 막는 것만으로는 부족하다 — 데몬의 15분 루프는 플래그를 다시 읽지
// 않으므로, HUD를 끈 뒤에도 최대 24시간 동안 usage API 조회가 이어진다.
// SIGTERM 핸들러가 PID 파일까지 정리하므로 신호만 보내면 된다.
function stopRunningDaemon(): void {
  try {
    if (!existsSync(PID_FILE)) return;
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    if (isNaN(pid) || pid === process.pid) return;
    process.kill(pid, "SIGTERM");
  } catch {
    // 이미 죽었거나(ESRCH) 신호를 못 보냄 — 스테일 PID 파일만 치운다.
    try {
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  }
}

// ── 로그 ──
// append로 연다. 훅이 매 턴 스폰하므로 실행 중인 데몬과 갓 뜬 프로세스가 같은
// 파일을 동시에 들 수 있는데, "w"로 열면 뒤에 온 쪽이 truncate 해 서로의 줄을
// 오프셋째로 덮어쓴다.
//
// 무한정 커지지 않게 한도를 넘으면 비우되, unlink가 아니라 ftruncate로 비운다.
// unlink는 이름만 지우므로 24시간 사는 데몬은 사라진 inode에 계속 쓰게 되고,
// 정작 보고 싶은 데몬 측 로그(cache updated / rate limited)가 새 파일에
// 나타나지 않는다. ftruncate면 같은 inode의 크기만 줄어 데몬 fd가 살아있다.
function openLog(): number | "ignore" {
  try {
    const fd = openSync(LOG_FILE, "a");
    try {
      if (fstatSync(fd).size > LOG_MAX_BYTES) ftruncateSync(fd, 0);
    } catch {
      // 크기 확인/절단 실패 — 로그가 좀 길어질 뿐이라 그대로 진행
    }
    return fd;
  } catch {
    return "ignore";
  }
}

// ── 데몬 분리 ──
// 훅에서 `&`로만 스폰되면 이 프로세스는 부모(Claude Code)의 stdout/stderr
// 파이프를 그대로 상속한다. 부모는 파이프 EOF를 기다리므로, 최대 24시간
// 사는 이 프로세스가 훅을 그만큼 붙잡는다 — 매 턴 멈추는 원인.
// 그래서 stdio를 끊은 detached 자식으로 자기 자신을 재스폰하고 부모는 즉시
// 빠진다. statusline.ts의 spawnCostWorker()와 같은 패턴이다.
// 호출부에 리다이렉션이 있든 없든 안전해진다.
function redetach(): boolean {
  // 이미 분리된 자식이면 재스폰하지 않는다. 환경변수와 argv 마커 중 하나만
  // 살아있어도 통과시킨다 — 이 가드가 뚫리면 결과가 node 부팅 속도의 재귀
  // 스폰이라, 비용이 없는 이중 확인을 둔다.
  if (process.env[DAEMON_ENV] === "1" || process.argv.includes(DAEMON_ARG)) {
    return false;
  }

  try {
    const out = openLog();

    const child = spawn(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), DAEMON_ARG],
      {
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env, [DAEMON_ENV]: "1" },
      }
    );
    child.unref();
    return true;
  } catch {
    // spawn이 동기적으로 던진 경우(인자 검증 실패 등)에만 여기로 온다.
    // exec 자체의 실패(ENOENT 등)는 비동기 "error" 이벤트라 여기서 잡히지
    // 않는데, 그때는 이 턴에 데몬이 뜨지 않고 다음 훅이 재시도한다.
    // process.execPath는 사실상 항상 유효하므로 실질 위험은 없다.
    return false;
  }
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
      try {
        process.kill(pid, "SIGUSR1");
        console.log(`[fetcher] sent SIGUSR1 to running process (pid: ${pid})`);
      } catch {}
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
    // 토큰 없음 — 캐시에 오류 기록 (유효한 기존 데이터만 보존)
    const existing = loadCache();
    const stale: HudCache = {
      _ts: Date.now(),
      _ok: false,
      ...(isUsageInfoFresh(existing?.five_hour) ? { five_hour: existing!.five_hour } : {}),
      ...(isUsageInfoFresh(existing?.seven_day) ? { seven_day: existing!.seven_day } : {}),
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
        ...(isUsageInfoFresh(existing?.five_hour) ? { five_hour: existing!.five_hour } : {}),
        ...(isUsageInfoFresh(existing?.seven_day) ? { seven_day: existing!.seven_day } : {}),
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

    // API 에러 (인증 실패 등) — 유효한 기존 데이터만 보존
    saveCache({
      _ts: Date.now(),
      _ok: false,
      ...(isUsageInfoFresh(existing?.five_hour) ? { five_hour: existing!.five_hour } : {}),
      ...(isUsageInfoFresh(existing?.seven_day) ? { seven_day: existing!.seven_day } : {}),
    });
    console.error("[fetcher] API returned unexpected response:", JSON.stringify(data));
  } catch (err) {
    // 네트워크 에러 — 유효한 기존 데이터만 보존
    saveCache({
      _ts: Date.now(),
      _ok: false,
      ...(isUsageInfoFresh(existing?.five_hour) ? { five_hour: existing!.five_hour } : {}),
      ...(isUsageInfoFresh(existing?.seven_day) ? { seven_day: existing!.seven_day } : {}),
    });
    console.error("[fetcher] network error:", err instanceof Error ? err.message : String(err));
  }
}

// ── Main ──
async function main(): Promise<void> {
  // HUD가 꺼져 있으면 새로 뜨지 않고, 이미 떠 있는 데몬도 멈춘다.
  // (재스폰보다 먼저 확인해 node 부팅 한 번을 매 턴 아낀다)
  if (isHudDisabled()) {
    stopRunningDaemon();
    process.exit(0);
  }

  // 부모의 stdout/stderr에서 분리 — 분리했으면 이 프로세스는 할 일이 없다
  if (redetach()) {
    process.exit(0);
  }

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

  // 즉시 첫 번째 fetch
  await fetchUsage();
  _lastSignalFetch = Date.now();

  // 15분마다 반복
  const interval = setInterval(() => { void fetchUsage(); }, FETCH_INTERVAL_MS);

  // 24시간 후 자동 종료 (MAX_LIFETIME_MS)
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
