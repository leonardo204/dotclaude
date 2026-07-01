// src/hud/cost.ts
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync
} from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
var PROJECTS_DIR = join(homedir(), ".claude", "projects");
var COST_CACHE_FILE = join(homedir(), ".claude", ".hud_cost_cache.json");
var PARSE_CACHE_DIR = join(homedir(), ".claude", ".hud_cost_parse");
var LOCK_FILE = join(homedir(), ".claude", ".hud_cost.lock");
var LOCK_TTL_MS = 3e3;
var PRICE = {
  "claude-fable-5": [10, 50, 12.5, 1],
  "claude-opus-4-8": [5, 25, 6.25, 0.5],
  "claude-opus-4-7": [5, 25, 6.25, 0.5],
  "claude-opus-4-6": [5, 25, 6.25, 0.5],
  "claude-opus-4-5": [5, 25, 6.25, 0.5],
  "claude-sonnet-4-6": [3, 15, 3.75, 0.3],
  "claude-sonnet-4-5": [3, 15, 3.75, 0.3],
  "claude-haiku-4-5": [1, 5, 1.25, 0.1]
};
function canon(model) {
  if (model.length > 9) {
    const s = model.slice(-9);
    if (s[0] === "-" && /^\d{8}$/.test(s.slice(1))) return model.slice(0, -9);
  }
  return model;
}
function localDate(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function resolveProjectDir(cwd) {
  const cands = [
    cwd.replace(/[/.]/g, "-"),
    cwd.replace(/[^a-zA-Z0-9]/g, "-")
  ];
  for (const c of cands) {
    const p = join(PROJECTS_DIR, c);
    if (existsSync(p)) return p;
  }
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
      let jf;
      try {
        jf = readdirSync(dir).find((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      if (!jf) continue;
      try {
        const head = readFileSync(join(dir, jf), "utf8").slice(0, 4e3);
        const mt = head.match(/"cwd":"([^"]*)"/);
        if (mt && mt[1] === cwd) return dir;
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function collectJsonl(dir, out) {
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
function parseFile(path) {
  const out = [];
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of content.split("\n")) {
    if (!line || line[0] !== "{") continue;
    let o;
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
      cr
    });
  }
  return out;
}
function evCost(e) {
  const pr = PRICE[e.m];
  if (!pr) return 0;
  return e.i / 1e6 * pr[0] + e.o / 1e6 * pr[1] + e.cc / 1e6 * pr[2] + e.cr / 1e6 * pr[3];
}
function readJson(path, fallback) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch {
  }
  return fallback;
}
function main() {
  const cwd = process.argv[2];
  if (!cwd) return;
  try {
    if (existsSync(LOCK_FILE)) {
      const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
      if (age < LOCK_TTL_MS) return;
    }
    writeFileSync(LOCK_FILE, String(process.pid));
  } catch {
  }
  const dir = resolveProjectDir(cwd);
  const cache = readJson(
    COST_CACHE_FILE,
    {}
  );
  const today = localDate(Date.now());
  if (!dir) {
    cache[cwd] = { today: 0, total: 0, date: today, ts: Date.now() };
    try {
      writeFileSync(COST_CACHE_FILE, JSON.stringify(cache));
    } catch {
    }
    return;
  }
  const files = [];
  collectJsonl(dir, files);
  const parseCacheFile = join(PARSE_CACHE_DIR, basename(dir) + ".json");
  const parseCache = readJson(parseCacheFile, {});
  const nextParseCache = {};
  const seen = /* @__PURE__ */ new Set();
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
    let events;
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
  }
}
main();
