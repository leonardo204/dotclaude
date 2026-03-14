/**
 * HUD Statusline — 컨텍스트 사용률 모니터링 진입점
 *
 * 성능 목표: ≤ 10ms (API 호출 없음, 로컬 파일만 읽음)
 *
 * 데이터 소스:
 * - stdin JSON: version, workspace, context_window, model, session_id
 * - ~/.claude/.hud_cache: rate limit 데이터 (fetcher.ts가 백그라운드에서 갱신)
 * - ~/.claude/projects/: 서브에이전트 카운팅
 *
 * 출력 형식:
 * [CC#1.0] | ~/work/project | 5h:38%(3h42m) wk:12%(2d5h) | Opus | ctx:14% | agents:0
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
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

// ── Cache file paths ──
const HUD_CACHE_FILE = join(homedir(), ".claude", ".hud_cache");
const AGENT_CACHE_FILE = join(homedir(), ".claude", ".agent_cache");
const AGENT_CACHE_TTL = 5000; // 5초

// ── HUD Cache 형식 ──
interface UsageInfo {
  utilization: number;
  resets_at?: string;
}

interface HudCache {
  _ts: number;
  _ok: boolean;
  five_hour?: UsageInfo;
  seven_day?: UsageInfo;
  [key: string]: unknown;
}

// ── Stdin 입력 형식 ──
interface StdinData {
  version?: string;
  workspace?: { current_dir?: string };
  cwd?: string;
  context_window?: {
    used_percentage?: number;
    context_window_size?: number;
    current_usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  model?: { display_name?: string };
  session_id?: string;
}

// ── Stdin 읽기 ──
async function readStdin(): Promise<StdinData | null> {
  if (process.stdin.isTTY) return null;
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) chunks.push(chunk as string);
  const raw = chunks.join("");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as StdinData;
  } catch {
    return null;
  }
}

// ── Context % 계산 ──
function getContextPercent(stdin: StdinData): number {
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
interface CtxState {
  current: number;
  previous: number;
  peak: number;
  alert: string;
  updated: string;
}

function updateCtxState(cwd: string, percent: number): CtxState {
  const statePath = join(cwd, ".claude", ".ctx_state");
  let state: CtxState = {
    current: 0,
    previous: 0,
    peak: 0,
    alert: "none",
    updated: "",
  };
  try {
    if (existsSync(statePath))
      state = JSON.parse(readFileSync(statePath, "utf8")) as CtxState;
  } catch {
    // ignore
  }

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
  } catch {
    // ignore
  }
  return state;
}

// ── 캐시 파일에서 usage 데이터 읽기 (API 호출 없음) ──
function loadHudCache(): HudCache | null {
  try {
    if (!existsSync(HUD_CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(HUD_CACHE_FILE, "utf8")) as HudCache;
    // 캐시가 있으면 stale 여부와 무관하게 반환 (fetcher가 주기적으로 갱신)
    // stale이면 "--%" 표시는 renderLimit에서 처리
    return data;
  } catch {
    return null;
  }
}

// ── Duration 포맷팅 ──
function formatDuration(ms: number): string | null {
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

// ── Rate limit 렌더링 ──
function renderLimit(label: string, info: UsageInfo | undefined): string | null {
  if (!info || info.utilization == null) return null;

  const raw = info.utilization;
  const pct = Math.round(raw >= 1 ? raw : raw * 100);
  const resetStr = info.resets_at
    ? formatDuration(new Date(info.resets_at).getTime() - Date.now())
    : null;

  const color = pct >= 90 ? C.red : pct >= 70 ? C.yellow : C.green;
  const resetPart = resetStr ? `${C.dim}(${resetStr})${C.reset}` : "";

  return `${label}:${color}${pct}%${C.reset}${resetPart}`;
}

// ── CWD 단축 ──
function shortenCwd(cwd: string): string {
  const home = homedir();
  if (cwd.startsWith(home)) {
    cwd = "~" + cwd.slice(home.length);
  }
  const parts = cwd.split("/");
  if (parts.length > 4) {
    return "…/" + parts.slice(-2).join("/");
  }
  return cwd;
}

// ── 에이전트 카운팅 (파일 기반 5초 TTL 캐시) ──
interface AgentCacheFile {
  active: number;
  total: number;
  ts: number;
}

function countSubagents(sessionId: string | undefined): { active: number; total: number } {
  if (!sessionId) return { active: 0, total: 0 };

  // 파일 기반 캐시 확인 (5초 TTL)
  try {
    if (existsSync(AGENT_CACHE_FILE)) {
      const mtime = statSync(AGENT_CACHE_FILE).mtimeMs;
      if (Date.now() - mtime < AGENT_CACHE_TTL) {
        const cached = JSON.parse(readFileSync(AGENT_CACHE_FILE, "utf8")) as AgentCacheFile;
        // sessionId가 같을 때만 캐시 사용
        return { active: cached.active, total: cached.total };
      }
    }
  } catch {
    // ignore
  }

  // 실제 스캔
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
        for (const f of transcripts) {
          try {
            const content = readFileSync(join(sessionDir, f), "utf8").trim();
            const lastLine = content.split("\n").pop() ?? "";
            const last = JSON.parse(lastLine);
            if (!last?.message?.stop_reason) active++;
          } catch {
            active++;
          }
        }
        result = { active, total: transcripts.length };
        break;
      }
    }
  } catch {
    // ignore
  }

  // 캐시 저장
  try {
    const cacheData: AgentCacheFile = { ...result, ts: Date.now() };
    writeFileSync(AGENT_CACHE_FILE, JSON.stringify(cacheData));
  } catch {
    // ignore
  }

  return result;
}

// ── Context % 렌더링 ──
function renderContext(percent: number): string {
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

// ── HUD disabled 체크 ──
const HUD_DISABLED_FILE = join(homedir(), ".claude", ".hud_disabled");

// ── Main ──
async function main(): Promise<void> {
  try {
    // HUD 비활성화 플래그 체크
    if (existsSync(HUD_DISABLED_FILE)) return;

    const stdin = await readStdin();
    if (!stdin) return;

    const parts: string[] = [];

    // 1. Version
    const ver = stdin.version;
    if (ver) {
      parts.push(`${C.dim}[CC#${ver}]${C.reset}`);
    }

    // 2. CWD
    const cwd =
      stdin.workspace?.current_dir ?? stdin.cwd ?? process.cwd();
    parts.push(`${C.cyan}${shortenCwd(cwd)}${C.reset}`);

    // 3. Rate limits — 캐시 파일에서만 읽음 (API 호출 없음)
    const cache = loadHudCache();
    if (cache !== null) {
      const limitParts: string[] = [];
      if (!cache.five_hour && !cache.seven_day) {
        // 캐시 있지만 데이터 없음 → "--%" 표시
        limitParts.push(`5h:${C.dim}--%${C.reset} wk:${C.dim}--%${C.reset}`);
      } else {
        const fiveH = renderLimit("5h", cache.five_hour);
        const weekly = renderLimit("wk", cache.seven_day);
        if (fiveH) limitParts.push(fiveH);
        if (weekly) limitParts.push(weekly);
      }
      if (limitParts.length > 0) {
        parts.push(limitParts.join(" "));
      }
    } else {
      // 캐시 파일 없음 → "--%" 표시
      parts.push(`5h:${C.dim}--%${C.reset} wk:${C.dim}--%${C.reset}`);
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
