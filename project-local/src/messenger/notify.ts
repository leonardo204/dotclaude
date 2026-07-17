/**
 * Stop 알림 — 재료 수집 · 메시지 조립 · 게이트 · 전송
 *
 * 왜 별도 모듈인가:
 *   알림은 두 경로에서 호출된다 — 통합 Stop 훅(hooks/events/stop.ts)과
 *   `messenger.sh notify` CLI(cli.ts). 조립 규칙(이스케이프·절단·섹션 생략)은
 *   한 곳에만 있어야 한다.
 *
 * 설계 방침 — 이 모듈은 **알림 특화**다:
 *   양방향 원격제어·승인대기 홀드는 만들지 않는다. Claude Code에 네이티브로 존재한다
 *   (Channels 플러그인 = 공식 Telegram 챗브릿지 + permission relay, Remote Control).
 *   우리가 대체할 수 없는 건 "프로젝트 컨텍스트가 담긴 리포트"뿐이므로 거기만 판다.
 *
 * 불변식:
 *   1. 어떤 재료든 없거나 실패하면 **그 섹션만 생략**한다. 알림 자체는 나간다.
 *   2. 본문은 전부 escapeHtml을 통과한다. <b> 서식은 이스케이프 **후** 조립한다(format.ts).
 *   3. Stop 경로를 지연시키지 않는다 — 블로킹 재계산 금지(비용 워커는 detached).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir, readConfig, type MessengerConfig } from './config.js';
import { bold, escapeHtml, formatDuration } from './format.js';
import { sendMessage, type SendResult } from './telegram.js';
import type { BackgroundTask, RawHookInput, StopInput } from '../shared/types.js';

/** Telegram sendMessage text 파라미터 상한. 초과하면 400으로 통째 유실된다. */
export const TELEGRAM_LIMIT = 4096;

/** last_assistant_message는 실측 921자였고 더 길 수 있다. 요약 섹션 상한. */
const SUMMARY_MAX = 700;
/** handoff는 SQL로 조립된 블록이라 길이가 예측 가능하지만 상한은 둔다. */
const HANDOFF_MAX = 600;

/**
 * 전송 상한. 훅 인라인 호출이므로 사용자 터미널이 이만큼 멈춘다.
 * 훅 기본 타임아웃(600초)에 기대면 안 된다.
 */
export const STOP_SEND_TIMEOUT_MS = 4000;

/** git 조회 상한. Stop 경로에 들어가므로 짧게 잡는다. */
const GIT_TIMEOUT_MS = 1000;

/**
 * 비용 캐시가 이보다 오래되면 워커를 **detached로** 재스폰한다.
 * HUD 렌더 주기(8초)보다 크게 잡는 이유: 알림에는 2분 전 비용도 충분히 유효하고,
 * 임계치가 낮으면 매 Stop마다 워커를 띄우게 된다.
 */
const COST_STALE_MS = 120_000;

/** 중복 방지 창. 구 bash 구현과 동일하게 30초. */
const DEDUP_WINDOW_SEC = 30;

/**
 * notify가 DB에서 읽는 표면.
 * ContextDB가 구조적으로 만족한다 — 중복 구현하지 않고 db.ts의 헬퍼를 그대로 쓴다.
 */
export interface NotifyDB {
  sessionCurrent(): number;
  sessionEditCount(sessionId: number): number;
  recentToolFiles(sessionId: number, limit?: number): string[];
  liveGet(key: string): string | null;
  query(sql: string): unknown[];
}

export interface CostFacts {
  today: number;
  total: number;
}

export interface RateLimitFacts {
  fiveHour: number;
  sevenDay: number;
}

/** 조립에 필요한 전부. 전 필드가 "없을 수 있다"를 표현한다. */
export interface NotifyFacts {
  projectPath: string;
  branch: string;
  startTimeStr: string;
  endTimeStr: string;
  elapsedSec: number;
  filesCount: number;
  /** last_assistant_message 기반. 없으면 live_context 폴백, 그것도 없으면 ''. */
  summary: string;
  cost: CostFacts | null;
  handoff: string;
  errors: string[];
  commits: string[];
  backgroundTasks: BackgroundTask[];
  rateLimit: RateLimitFacts | null;
  /** 테스트/E2E 표기용 머리말. 미지정 시 '세션 종료'. */
  tag?: string;
}

// ─── 시각 유틸 ───

export const nowEpoch = (): number => Math.floor(Date.now() / 1000);

/** epoch(초) → 로컬 시각 문자열. 구 bash `date -r <epoch> "+<fmt>"` 동등. */
export function formatEpoch(epoch: number, withDate: boolean): string {
  const d = new Date(epoch * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  if (!withDate) return time;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
}

function localDate(now: number = Date.now()): string {
  const d = new Date(now);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 길이 상한을 넘으면 말줄임한다. 조립 **전**(평문 단계)에 쓴다. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * last_assistant_message에서 알림용 요약을 뽑는다.
 *
 * 문제: last_assistant_message는 마크다운 원문이라 코드블록·불릿·표를 통째로
 * 담으면 알림이 장황해진다(실측: 코드펜스 여러 개가 그대로 들어감). 네이티브
 * 푸시가 못 하는 "프로젝트 컨텍스트"가 목적이지 응답 전문 복붙이 목적이 아니다.
 *
 * 그래서 코드블록을 걷어내고, 첫 산문 문단만 취해 마크다운 기호를 정리한다.
 */
export function summarize(text: string, max: number): string {
  // 1) 코드펜스(``` … ```) 블록 제거
  let t = text.replace(/```[\s\S]*?```/g, ' ').replace(/```[\s\S]*$/g, ' ');
  // 2) 문단 경계로 나눠 첫 "산문" 문단을 고른다 — 헤더/불릿/인용/표로만 된 건 건너뛴다
  const paras = t.split(/\n\s*\n/).map((p) => p.trim());
  const prose = paras.find((p) => p && !/^[#>|\-*\d.]/.test(p)) ?? paras.find((p) => p) ?? '';
  // 3) 인라인 마크다운 기호 정리: **강조**·`코드`·[링크](url) → 텍스트만
  t = prose
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(t, max);
}

// ─── 재료: 비용 ───

interface CostEntry {
  today: number;
  total: number;
  date: string;
  ts: number;
}

function costCachePath(home: string): string {
  return join(home, '.claude', '.hud_cost_cache.json');
}

/**
 * 비용 워커를 **detached로** 띄운다 (fire-and-forget).
 *
 * 왜 동기 실행이 아닌가: cost.js는 ~/.claude/projects/**\/*.jsonl 을 파싱한다(무겁다).
 * Stop 경로에서 동기로 돌리면 사용자 터미널이 그만큼 멈춘다 — 이 모듈의 3번 불변식 위반.
 * detached면 0ms이고, cost.js 자체가 3초 락으로 몰림을 막는다. HUD가 꺼져 있어도
 * 이 스폰이 캐시를 데워 두므로 다음 알림부터 비용이 붙는다.
 * (첫 알림에서 비용 섹션이 빠지는 건 1번 불변식대로 허용한다)
 */
function spawnCostWorker(cwd: string, home: string): void {
  try {
    const candidates = [
      join(dirname(fileURLToPath(import.meta.url)), '../hud/cost.js'),
      join(home, '.claude', 'dist', 'hud', 'cost.js'),
    ];
    const worker = candidates.find((p) => existsSync(p));
    if (!worker) return;
    const child = spawn(process.execPath, [worker, cwd], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // 폴백 실패가 알림 전체를 죽이면 안 된다
  }
}

/**
 * HUD statusline이 갱신하는 비용 캐시를 읽는다. cwd가 키인 JSON이다.
 * 캐시가 stale하거나 없으면 워커를 detached로 띄우고, 이번 알림은 있는 값으로 간다.
 */
export function loadCost(cwd: string, home: string = homeDir()): CostFacts | null {
  let entry: CostEntry | undefined;
  try {
    const path = costCachePath(home);
    if (existsSync(path)) {
      const map = JSON.parse(readFileSync(path, 'utf8')) as Record<string, CostEntry>;
      entry = map[cwd];
    }
  } catch {
    // 캐시 깨짐 — 없는 것으로 취급
  }

  const stale = !entry || Date.now() - entry.ts > COST_STALE_MS || entry.date !== localDate();
  if (stale) spawnCostWorker(cwd, home);

  if (!entry) return null;
  // 날짜가 넘어갔으면 today는 갱신 전까지 0 (누적은 유효)
  return { total: entry.total, today: entry.date === localDate() ? entry.today : 0 };
}

// ─── 재료: 레이트리밋 ───

interface HudCache {
  _ok?: boolean;
  _rateLimited?: boolean;
  five_hour?: { utilization?: number };
  seven_day?: { utilization?: number };
}

/** fetcher가 갱신하는 사용량 캐시. `_ok`/`_rateLimited` 봉투를 확인한 뒤에만 쓴다. */
export function loadRateLimit(home: string = homeDir()): RateLimitFacts | null {
  try {
    const path = join(home, '.claude', '.hud_cache');
    if (!existsSync(path)) return null;
    const c = JSON.parse(readFileSync(path, 'utf8')) as HudCache;
    if (c._ok !== true || c._rateLimited === true) return null;
    const five = c.five_hour?.utilization;
    const seven = c.seven_day?.utilization;
    if (typeof five !== 'number' || typeof seven !== 'number') return null;
    return { fiveHour: five, sevenDay: seven };
  } catch {
    return null;
  }
}

// ─── 재료: git ───

export function gitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// ─── 재료 수집 ───

export interface GatherInput {
  db: NotifyDB | null;
  projectRoot: string;
  stop: RawHookInput<StopInput>;
  home?: string;
  tag?: string;
}

/** live_context에서 첫 비어 있지 않은 값을 고른다. */
function pickLive(db: NotifyDB, keys: string[]): string {
  for (const k of keys) {
    try {
      const v = db.liveGet(k);
      if (v) return v;
    } catch {
      // 다음 키로
    }
  }
  return '';
}

export function gatherFacts({ db, projectRoot, stop, home = homeDir(), tag }: GatherInput): NotifyFacts {
  const facts: NotifyFacts = {
    projectPath: projectRoot,
    branch: '',
    startTimeStr: '',
    endTimeStr: formatEpoch(nowEpoch(), false),
    elapsedSec: 0,
    filesCount: 0,
    summary: '',
    cost: null,
    handoff: '',
    errors: [],
    commits: [],
    backgroundTasks: [],
    rateLimit: null,
  };
  if (tag) facts.tag = tag;

  facts.branch = gitBranch(projectRoot);
  facts.cost = loadCost(projectRoot, home);
  facts.rateLimit = loadRateLimit(home);

  // 진짜 상태: Stop 페이로드의 last_assistant_message.
  // 공식 문서: "Hooks that need the final assistant text should use
  // last_assistant_message instead of reading the transcript".
  // (구 구현이 파싱하던 `.reason` 필드는 실측상 **존재하지 않는다** — 상수 'completed'였다)
  if (typeof stop.last_assistant_message === 'string') {
    facts.summary = summarize(stop.last_assistant_message, SUMMARY_MAX);
  }
  if (Array.isArray(stop.background_tasks)) {
    facts.backgroundTasks = stop.background_tasks;
  }

  if (!db) return facts;

  let sessionId = 0;
  try {
    sessionId = db.sessionCurrent();
  } catch {
    // 세션 없음 — DB 재료는 전부 생략된다
  }

  // 경과 시간 + 이번 턴 편집 파일 수
  let promptEpoch = 0;
  try {
    promptEpoch = Number(db.liveGet('messenger_prompt_time') ?? 0) || 0;
  } catch {
    // 무시
  }
  if (promptEpoch > 0) {
    facts.startTimeStr = formatEpoch(promptEpoch, false);
    facts.elapsedSec = nowEpoch() - promptEpoch;
    try {
      // 보간값은 우리가 만든 'YYYY-MM-DD HH:MM:SS' 리터럴이다(외부 입력 아님).
      const promptDt = formatEpoch(promptEpoch, true);
      const rows = db.query(
        `SELECT COUNT(DISTINCT file_path) AS n FROM tool_usage
         WHERE tool_name IN ('Edit','Write') AND file_path IS NOT NULL
           AND timestamp >= '${promptDt}'`
      ) as Array<{ n: number }>;
      facts.filesCount = rows[0]?.n ?? 0;
    } catch {
      // 무시
    }
  } else if (sessionId > 0) {
    // prompt_time이 없으면 턴 범위를 모른다 → 세션 누적으로 폴백
    try {
      facts.filesCount = db.sessionEditCount(sessionId);
    } catch {
      // 무시
    }
  }

  // 요약 폴백: last_assistant_message가 없을 때만
  if (!facts.summary) {
    const fallback = pickLive(db, ['current_task', 'key_findings', 'session_summary']);
    if (fallback) facts.summary = clip(fallback, SUMMARY_MAX);
  }

  // handoff — 통합 핸들러가 **쓴 다음** 읽으므로 이번 세션 값이다.
  // (구 구조에서는 messenger가 별도 프로세스로 병렬 실행돼 쓰기 전에 읽을 수 있었다)
  try {
    const h = db.liveGet('session_handoff');
    if (h) facts.handoff = clip(h, HANDOFF_MAX);
  } catch {
    // 무시
  }

  if (sessionId > 0 && Number.isInteger(sessionId)) {
    // 에러 — PostToolUseFailure 훅 수리 후 실제로 기록된다
    try {
      const rows = db.query(
        `SELECT error_type, COALESCE(file_path,'') AS file_path FROM errors
         WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 3`
      ) as Array<{ error_type: string; file_path: string }>;
      facts.errors = rows.map((r) => (r.file_path ? `${r.error_type}: ${r.file_path}` : r.error_type));
    } catch {
      // 무시
    }

    try {
      const rows = db.query(
        `SELECT message FROM commits WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 5`
      ) as Array<{ message: string }>;
      facts.commits = rows.map((r) => String(r.message).split('\n')[0] ?? '');
    } catch {
      // 무시
    }
  }

  return facts;
}

// ─── 절단 ───

/** 열린 <b>가 남아 있으면 닫는다. 절단이 헤더 줄 한복판을 지났을 때의 안전장치. */
function balanceBold(html: string): string {
  const open = (html.match(/<b>/g) ?? []).length;
  const close = (html.match(/<\/b>/g) ?? []).length;
  return open > close ? html + '</b>'.repeat(open - close) : html;
}

/**
 * 엔티티(&lt;)나 태그(<b>) 한복판에서 잘리지 않는 지점까지 물러난다.
 * 줄 경계 절단이 불가능할 때(한 줄이 상한보다 길 때)만 쓰인다.
 */
function safeCut(text: string, budget: number): number {
  let cut = budget;
  const amp = text.lastIndexOf('&', cut - 1);
  if (amp >= 0 && text.indexOf(';', amp) >= cut) cut = amp;
  const lt = text.lastIndexOf('<', cut - 1);
  if (lt >= 0 && text.indexOf('>', lt) >= cut) cut = lt;
  return Math.max(cut, 0);
}

/**
 * Telegram 상한에 맞춰 절단한다.
 *
 * 줄 경계에서 자르는 이유: 이 모듈의 서식(<b>제목</b>)은 전부 한 줄 안에서 열고 닫는다.
 * 줄 경계로 자르면 태그도 엔티티도 쪼개지지 않는다. 한 줄이 상한보다 긴 병리적 경우에만
 * safeCut으로 물러나고 balanceBold로 마감한다.
 */
export function truncateHtml(text: string, limit: number = TELEGRAM_LIMIT): string {
  if (text.length <= limit) return text;
  const marker = '\n… (생략)';
  const budget = limit - marker.length;

  let cut = text.lastIndexOf('\n', budget);
  if (cut <= 0) cut = safeCut(text, budget);
  return balanceBold(text.slice(0, cut)) + marker;
}

// ─── 메시지 조립 ───

/**
 * 알림 본문을 만든다. **순수 함수** — 여기서 I/O를 하지 않는다.
 * 재료가 비면 해당 섹션은 통째로 빠진다(1번 불변식).
 */
export function buildNotifyMessage(facts: NotifyFacts): string {
  const lines: string[] = [];
  const section = (title: string, body: string[]): void => {
    if (body.length === 0) return;
    lines.push('');
    lines.push(bold(title));
    lines.push(...body);
  };

  lines.push(bold(`[dotclaude] ${facts.tag ?? '세션 종료'}`));

  const branch = facts.branch ? ` (${escapeHtml(facts.branch)})` : '';
  lines.push(`프로젝트: ${escapeHtml(facts.projectPath)}${branch}`);

  // 상태는 실제 신호에서만 만든다. 구 구현의 'completed' 상수는 폐기했다.
  const running = facts.backgroundTasks.filter((t) => t.status === 'running');
  lines.push(
    running.length > 0
      ? `상태: 응답 완료 — 백그라운드 ${running.length}건 진행 중`
      : '상태: 응답 완료'
  );

  const start = facts.startTimeStr || facts.endTimeStr;
  lines.push(`시간: ${escapeHtml(start)} → ${escapeHtml(facts.endTimeStr)} (${escapeHtml(formatDuration(facts.elapsedSec))})`);
  lines.push(`파일: ${facts.filesCount}개`);

  if (facts.cost) {
    lines.push(`비용: 오늘 $${facts.cost.today.toFixed(2)} / 누적 $${facts.cost.total.toFixed(2)}`);
  }
  if (facts.rateLimit) {
    lines.push(`한도: 5시간 ${facts.rateLimit.fiveHour}% · 7일 ${facts.rateLimit.sevenDay}%`);
  }

  section('요약', facts.summary ? [escapeHtml(facts.summary)] : []);

  // 백그라운드 작업은 오해 방지용이다 — "끝났다고 알림이 왔는데 서브에이전트가
  // 아직 돌고 있었다"를 막는다.
  section(
    `백그라운드 (${facts.backgroundTasks.length}건)`,
    facts.backgroundTasks.map((t) => {
      const kind = t.agent_type ? `${t.type}/${t.agent_type}` : t.type;
      return `- [${escapeHtml(t.status)}] ${escapeHtml(kind)} — ${escapeHtml(t.description)}`;
    })
  );

  section(
    `에러 (${facts.errors.length}건)`,
    facts.errors.map((e) => `- ${escapeHtml(e)}`)
  );
  section(
    `커밋 (${facts.commits.length}건)`,
    facts.commits.map((c) => `- ${escapeHtml(c)}`)
  );
  section('핸드오프', facts.handoff ? [escapeHtml(facts.handoff)] : []);

  return truncateHtml(lines.join('\n'));
}

// ─── 게이트 ───

/** scope=project면 해당 프로젝트에 .messenger_enabled가 있어야 한다. */
export function checkScope(scope: string, projectRoot: string): boolean {
  if (scope !== 'project') return true;
  return existsSync(join(projectRoot, '.claude', '.messenger_enabled'));
}

/** 30초 중복 방지. 구 bash 구현과 동일하게 **게이트 판정 전에** 창을 소비한다. */
function dedupBlocked(file: string, now: number): boolean {
  try {
    const last = Number(readFileSync(file, 'utf8').trim()) || 0;
    if (now > 0 && last > 0 && now - last < DEDUP_WINDOW_SEC) return true;
  } catch {
    // 파일 없음 — 첫 알림
  }
  try {
    writeFileSync(file, `${now}\n`);
  } catch {
    // 무시
  }
  return false;
}

export type NotifyOutcome = 'sent' | 'skipped' | 'failed';

export interface StopNotifyOptions {
  db: NotifyDB | null;
  projectRoot: string;
  stop: RawHookInput<StopInput>;
  /** 테스트 주입 — 미지정 시 ~/.claude/messenger.json을 읽는다. */
  config?: MessengerConfig | null;
  /** 테스트 주입 — 미지정 시 telegram.ts의 sendMessage. */
  sendImpl?: typeof sendMessage;
  /** 테스트/E2E 격리용. 미지정 시 ~/.claude/.messenger_last_notify. */
  dedupFile?: string;
  home?: string;
  tag?: string;
}

/**
 * 게이트를 통과하면 알림을 보낸다.
 *
 * 게이트 순서는 구 bash 구현을 그대로 보존한다:
 *   enabled → 30초 중복방지 → (재료 수집) → min_duration → scope
 */
export async function runStopNotify(opts: StopNotifyOptions): Promise<NotifyOutcome> {
  const home = opts.home ?? homeDir();
  const cfg = opts.config !== undefined ? opts.config : readConfig();
  if (!cfg) return 'skipped';
  if (!cfg.bot_token || !cfg.chat_id) return 'skipped';
  if (!cfg.enabled) return 'skipped';

  const dedupFile = opts.dedupFile ?? join(home, '.claude', '.messenger_last_notify');
  if (dedupBlocked(dedupFile, nowEpoch())) return 'skipped';

  const gather: GatherInput = { db: opts.db, projectRoot: opts.projectRoot, stop: opts.stop, home };
  if (opts.tag !== undefined) gather.tag = opts.tag;
  const facts = gatherFacts(gather);

  if (cfg.min_duration > 0 && facts.elapsedSec > 0 && facts.elapsedSec < cfg.min_duration) {
    return 'skipped';
  }
  if (!checkScope(cfg.scope || 'global', opts.projectRoot)) return 'skipped';

  const send = opts.sendImpl ?? sendMessage;
  let res: SendResult;
  try {
    res = await send(cfg.bot_token, cfg.chat_id, buildNotifyMessage(facts), {
      timeoutMs: STOP_SEND_TIMEOUT_MS,
    });
  } catch {
    // 전송 예외가 Stop 경로를 죽이면 안 된다
    return 'failed';
  }
  return res.ok ? 'sent' : 'failed';
}
