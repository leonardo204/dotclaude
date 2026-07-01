/**
 * Cost 워커 — 프로젝트 비용을 ccusage 방식으로 집계 (백그라운드 1회성)
 *
 * statusline이 stale 시 detached로 스폰한다: `node cost.js <cwd>`
 * 렌더 핫패스에서 절대 실행하지 않는다 (JSONL 파싱은 무겁다).
 *
 * 방식 (ccusage / codex-island 패리티):
 * - ~/.claude/projects/<encoded cwd>/**\/*.jsonl 재귀 파싱 (서브에이전트 포함)
 * - assistant 메시지의 usage 토큰을 messageId:requestId 로 전역 중복제거
 * - 모델별 flat 단가(litellm 스냅샷)를 곱해 오늘/누적 비용 산출
 *   (Opus 4.x/Fable 5는 1M 컨텍스트에도 프리미엄 요율 없음 — flat)
 * - 파일별 파싱 결과를 mtime+size 로 캐시 → 변경된 파일만 재파싱
 *
 * 출력: ~/.claude/.hud_cost_cache.json  { "<cwd>": {today,total,date,ts} }
 *   cwd 를 키로 쓰므로 프로젝트에 .claude 디렉토리가 없어도 동작한다.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const COST_CACHE_FILE = join(homedir(), ".claude", ".hud_cost_cache.json");
// 파스 캐시는 프로젝트별 파일로 분리 (프로젝트 간 캐시 덮어쓰기 방지)
const PARSE_CACHE_DIR = join(homedir(), ".claude", ".hud_cost_parse");
const LOCK_FILE = join(homedir(), ".claude", ".hud_cost.lock");
const LOCK_TTL_MS = 3000; // 이 시간 내 다른 워커가 돌았으면 스킵 (파일 몰림 방지)

// ── 단가 (USD / 100만 토큰): [input, output, cache_creation, cache_read] ──
// litellm 스냅샷 기준. Anthropic Opus 4.x·Fable 5는 200k 초과에도 프리미엄 없음(flat).
const PRICE: Record<string, [number, number, number, number]> = {
  "claude-fable-5": [10, 50, 12.5, 1.0],
  "claude-opus-4-8": [5, 25, 6.25, 0.5],
  "claude-opus-4-7": [5, 25, 6.25, 0.5],
  "claude-opus-4-6": [5, 25, 6.25, 0.5],
  "claude-opus-4-5": [5, 25, 6.25, 0.5],
  "claude-sonnet-4-6": [3, 15, 3.75, 0.3],
  "claude-sonnet-4-5": [3, 15, 3.75, 0.3],
  "claude-haiku-4-5": [1, 5, 1.25, 0.1],
};

// "claude-haiku-4-5-20251001" → "claude-haiku-4-5" (9자 날짜 접미사 제거)
function canon(model: string): string {
  if (model.length > 9) {
    const s = model.slice(-9);
    if (s[0] === "-" && /^\d{8}$/.test(s.slice(1))) return model.slice(0, -9);
  }
  return model;
}

function localDate(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── 파일별 파싱 캐시 이벤트 ──
interface Ev {
  k: string; // dedup key "messageId:requestId" (없으면 "")
  m: string; // canonical model
  ts: number; // epoch ms
  i: number;
  o: number;
  cc: number;
  cr: number;
}
interface FileCacheEntry {
  mtime: number;
  size: number;
  events: Ev[];
}
type ParseCache = Record<string, FileCacheEntry>;

// ── cwd → 프로젝트 로그 디렉토리 해석 ──
function resolveProjectDir(cwd: string): string | null {
  const cands = [
    cwd.replace(/[/.]/g, "-"),
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  ];
  for (const c of cands) {
    const p = join(PROJECTS_DIR, c);
    if (existsSync(p)) return p;
  }
  // 폴백: 각 프로젝트 디렉토리의 첫 jsonl에 기록된 cwd 필드로 매칭
  try {
    for (const name of readdirSync(PROJECTS_DIR)) {
      const dir = join(PROJECTS_DIR, name);
      let stat;
      try {
        stat = statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      let jf: string | undefined;
      try {
        jf = readdirSync(dir).find((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      if (!jf) continue;
      try {
        const head = readFileSync(join(dir, jf), "utf8").slice(0, 4000);
        const mt = head.match(/"cwd":"([^"]*)"/);
        if (mt && mt[1] === cwd) return dir;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// ── 디렉토리 재귀: *.jsonl 파일 경로 수집 ──
function collectJsonl(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collectJsonl(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
}

// ── 한 파일 파싱 → Ev[] ──
function parseFile(path: string): Ev[] {
  const out: Ev[] = [];
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of content.split("\n")) {
    if (!line || line[0] !== "{") continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "assistant") continue;
    const msg = o.message;
    if (!msg || !msg.usage || !msg.model) continue;
    if (msg.model === "<synthetic>" || String(msg.model).startsWith("synthetic"))
      continue;
    const u = msg.usage;
    const i = u.input_tokens || 0;
    const oo = u.output_tokens || 0;
    const cc = u.cache_creation_input_tokens || 0;
    const cr = u.cache_read_input_tokens || 0;
    if (!i && !oo && !cc && !cr) continue;
    const ts = Date.parse(o.timestamp || "") || 0;
    const mid = msg.id || "";
    const rid = o.requestId || "";
    out.push({
      k: mid && rid ? `${mid}:${rid}` : "",
      m: canon(msg.model),
      ts,
      i,
      o: oo,
      cc,
      cr,
    });
  }
  return out;
}

function evCost(e: Ev): number {
  const pr = PRICE[e.m];
  if (!pr) return 0; // 미등록 모델 → $0 (ccusage 패리티)
  return (
    (e.i / 1e6) * pr[0] +
    (e.o / 1e6) * pr[1] +
    (e.cc / 1e6) * pr[2] +
    (e.cr / 1e6) * pr[3]
  );
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // ignore
  }
  return fallback;
}

function main(): void {
  const cwd = process.argv[2];
  if (!cwd) return;

  // 락: 최근 워커가 방금 돌았으면 스킵
  try {
    if (existsSync(LOCK_FILE)) {
      const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
      if (age < LOCK_TTL_MS) return;
    }
    writeFileSync(LOCK_FILE, String(process.pid));
  } catch {
    // ignore
  }

  const dir = resolveProjectDir(cwd);
  const cache = readJson<Record<string, { today: number; total: number; date: string; ts: number }>>(
    COST_CACHE_FILE,
    {}
  );
  const today = localDate(Date.now());

  if (!dir) {
    // 로그 없음 → 0 기록 (statusline은 total<=0이면 숨김)
    cache[cwd] = { today: 0, total: 0, date: today, ts: Date.now() };
    try {
      writeFileSync(COST_CACHE_FILE, JSON.stringify(cache));
    } catch {
      // ignore
    }
    return;
  }

  const files: string[] = [];
  collectJsonl(dir, files);

  const parseCacheFile = join(PARSE_CACHE_DIR, basename(dir) + ".json");
  const parseCache = readJson<ParseCache>(parseCacheFile, {});
  const nextParseCache: ParseCache = {};

  const seen = new Set<string>();
  let total = 0;
  let todayCost = 0;

  for (const f of files) {
    let st;
    try {
      st = statSync(f);
    } catch {
      continue;
    }
    const cached = parseCache[f];
    let events: Ev[];
    if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) {
      events = cached.events;
    } else {
      events = parseFile(f);
    }
    nextParseCache[f] = { mtime: st.mtimeMs, size: st.size, events };

    for (const e of events) {
      if (e.k) {
        if (seen.has(e.k)) continue;
        seen.add(e.k);
      }
      const c = evCost(e);
      total += c;
      if (localDate(e.ts) === today) todayCost += c;
    }
  }

  cache[cwd] = { today: todayCost, total, date: today, ts: Date.now() };
  try {
    writeFileSync(COST_CACHE_FILE, JSON.stringify(cache));
    mkdirSync(PARSE_CACHE_DIR, { recursive: true });
    writeFileSync(parseCacheFile, JSON.stringify(nextParseCache));
  } catch {
    // ignore
  }
}

main();
