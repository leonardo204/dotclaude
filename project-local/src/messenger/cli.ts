/**
 * messenger CLI — 구 messenger.sh(bash 596줄)의 TypeScript 대체
 *
 * 하위 호환이 최우선이다. 서브커맨드 시그니처·출력 문자열(색상 이스케이프 포함)·
 * 종료 코드가 bash와 동일해야 한다. 기준선은 test/golden/ 에 캡처돼 있고
 * test/messenger-golden.test.mjs 가 매 테스트마다 대조한다.
 *
 * bash 대비 의도된 차이는 셋뿐이다:
 *   1) 본문 HTML 이스케이프 — 구현은 format.ts 참조 (알림 유실 버그 수정)
 *   2) 설정 쓰기가 문자열 보간이 아니라 JSON 직렬화 — config.ts 참조 (인젝션 수정)
 *   3) 전송 실패를 ~/.claude/messenger.log 에 남김 (토큰 redact 후) — telegram.ts 참조
 *   + 도움말 예시를 placeholder로 교체 — 원본에 실제 chat_id 원문과 실제 봇 토큰
 *     앞부분이 하드코딩돼 공개 저장소에 커밋돼 있었다(600b560~834abba).
 *     경위는 test/golden/README.md 참조.
 *
 * 이번 단계 범위는 CLI 표면과 전송 코어뿐이다. notify/prompt-time은 bash 동작을
 * 그대로 옮기기만 한다. Stop 훅 통합은 다음 단계다.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configPath, homeDir, readConfig, writeConfig, type MessengerConfig } from './config.js';
import { escapeHtml, formatDuration, padByte } from './format.js';
import { sendMessage } from './telegram.js';

// ─── 색상 (bash 원본과 동일한 시퀀스) ───
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const out = (s: string): void => void process.stdout.write(s);
const err = (s: string): void => void process.stderr.write(s);

// 각 접두사 뒤 공백 수는 bash printf 포맷과 정확히 같다 (info/warn 2칸, error 1칸, ok 4칸).
const info = (m: string): void => out(`${BLUE}[info]${RESET}  ${m}\n`);
const warn = (m: string): void => out(`${YELLOW}[warn]${RESET}  ${m}\n`);
const ok = (m: string): void => out(`${GREEN}[ok]${RESET}    ${m}\n`);
const error = (m: string): void => err(`${RED}[error]${RESET} ${m}\n`);

/** 매 호출마다 평가한다 — 테스트가 HOME을 갈아끼운다. */
const CONFIG_FILE = (): string => configPath();

// ─── 도움말 ───
function showHelp(): void {
  out('\n');
  out(`${BOLD}messenger.sh${RESET} — Telegram 메신저 알림 스크립트\n`);
  out('\n');
  out('사용법:\n');
  out('  messenger.sh config <bot_token> <chat_id>  봇 토큰과 채팅 ID 설정\n');
  out('  messenger.sh test                           테스트 메시지 전송\n');
  out('  messenger.sh on                             알림 활성화\n');
  out('  messenger.sh off                            알림 비활성화\n');
  out('  messenger.sh send "메시지"                  메시지 전송\n');
  out('  messenger.sh status                         현재 설정 상태 표시\n');
  out('  messenger.sh notify                         세션 종료 알림 (Stop hook 전용)\n');
  out('  messenger.sh set min_duration <초>          최소 알림 시간 설정\n');
  out('  messenger.sh set scope <global|project>     알림 범위 설정\n');
  out('  messenger.sh get <key>                      설정값 조회\n');
  out('\n');
  out(`설정 파일: ${CONFIG_FILE()}\n`);
  out('\n');
  out('예시:\n');
  // placeholder 유지. 원본은 실제 봇 토큰 앞부분과 실제 chat_id를 하드코딩해
  // 공개 repo에 커밋된 상태였다. 절대 실값으로 되돌리지 말 것.
  out('  messenger.sh config <BOT_TOKEN> <CHAT_ID>\n');
  out('  messenger.sh test\n');
  out('  messenger.sh send "빌드 완료!"\n');
  out('  messenger.sh set min_duration 300\n');
  out('  messenger.sh set scope project\n');
  out('\n');
}

/** 설정 파일이 없을 때 bash가 내던 2줄 에러. */
function errorNoConfig(): void {
  error('설정 파일이 없습니다.');
  error('먼저 설정하세요: messenger.sh config <bot_token> <chat_id>');
}

// ─── config ───
function cmdConfig(args: string[]): number {
  if (args.length < 2) {
    error('사용법: messenger.sh config <bot_token> <chat_id>');
    return 1;
  }
  const [token, chat] = args as [string, string];

  // 기존 설정의 enabled/min_duration/scope 값 유지
  const existing = readConfig();
  const next: MessengerConfig = {
    bot_token: token,
    chat_id: chat,
    enabled: existing?.enabled ?? true,
    min_duration: existing?.min_duration ?? 0,
    scope: existing?.scope ?? 'global',
  };
  writeConfig(next);

  ok(`설정 저장 완료: ${CONFIG_FILE()}`);
  info('권한 설정: chmod 600 (소유자만 읽기/쓰기)');
  info(`bot_token: ${token.slice(0, 10)}...`);
  info(`chat_id: ${chat}`);
  out('\n');
  info('테스트: messenger.sh test');
  return 0;
}

// ─── test ───
async function cmdTest(): Promise<number> {
  const cfg = readConfig();
  if (!cfg) {
    errorNoConfig();
    return 1;
  }
  if (!cfg.bot_token || !cfg.chat_id) {
    error('bot_token 또는 chat_id가 비어 있습니다.');
    error('다시 설정하세요: messenger.sh config <bot_token> <chat_id>');
    return 1;
  }

  info('테스트 메시지 전송 중...');
  const msg = '[dotclaude] 텔레그램 알림 테스트 성공! ✅';
  const res = await sendMessage(cfg.bot_token, cfg.chat_id, escapeHtml(msg));
  if (res.ok) {
    ok('테스트 메시지 전송 완료');
    return 0;
  }
  error(`Telegram API 오류: ${res.description}`);
  error('테스트 메시지 전송 실패');
  return 1;
}

// ─── on / off ───
function cmdToggle(enabled: boolean): number {
  const cfg = readConfig();
  if (!cfg) {
    errorNoConfig();
    return 1;
  }
  writeConfig({ ...cfg, enabled });
  ok(enabled ? '알림 활성화됨' : '알림 비활성화됨');
  return 0;
}

// ─── send ───
async function cmdSend(args: string[]): Promise<number> {
  if (args.length < 1) {
    error('사용법: messenger.sh send "메시지"');
    return 1;
  }
  const message = args[0] as string;

  const cfg = readConfig();
  if (!cfg) {
    // 설정 없으면 안내하고 종료 (에러 아님 — 스킵)
    info('Telegram 알림 미설정 — 전송 스킵');
    info('설정하려면: messenger.sh config <bot_token> <chat_id>');
    return 0;
  }
  if (!cfg.bot_token || !cfg.chat_id) {
    info('bot_token 또는 chat_id가 비어 있음 — 전송 스킵');
    return 0;
  }
  if (!cfg.enabled) {
    info('알림 비활성화 상태 — 전송 스킵 (활성화: messenger.sh on)');
    return 0;
  }

  // 평문을 보낸다 → 전송 직전에 이스케이프한다. 이게 400 유실 버그의 수정 지점이다.
  const res = await sendMessage(cfg.bot_token, cfg.chat_id, escapeHtml(message));
  if (res.ok) {
    ok('메시지 전송 완료');
    return 0;
  }
  error(`Telegram API 오류: ${res.description}`);
  error('메시지 전송 실패');
  return 1;
}

// ─── set ───
function cmdSet(args: string[]): number {
  if (args.length < 2) {
    error('사용법: messenger.sh set <min_duration|scope> <값>');
    return 1;
  }
  const [key, value] = args as [string, string];

  const cfg = readConfig();
  if (!cfg) {
    errorNoConfig();
    return 1;
  }

  switch (key) {
    case 'min_duration': {
      if (!/^[0-9]+$/.test(value)) {
        error('min_duration 은 정수(초)여야 합니다. 예: messenger.sh set min_duration 300');
        return 1;
      }
      writeConfig({ ...cfg, min_duration: Number(value) });
      const human = formatDuration(Number(value));
      ok(`최소 알림 시간 설정: ${value}초 (${human}) — 이 시간 미만 작업은 알림 스킵`);
      return 0;
    }
    case 'scope': {
      if (value !== 'global' && value !== 'project') {
        error("scope 는 'global' 또는 'project' 이어야 합니다.");
        return 1;
      }
      writeConfig({ ...cfg, scope: value });
      ok(`알림 범위 설정: ${value}`);
      if (value === 'project') {
        info('프로젝트별 활성화: 해당 프로젝트에서 /dotclaude-messenger 실행 후 메뉴 4번 선택');
      }
      return 0;
    }
    default:
      error(`알 수 없는 설정 키: ${key} (사용 가능: min_duration, scope)`);
      return 1;
  }
}

// ─── get ───
function cmdGet(args: string[]): number {
  if (args.length < 1) {
    error('사용법: messenger.sh get <key>');
    return 1;
  }
  const key = args[0] as string;

  const cfg = readConfig();
  if (!cfg) {
    out('\n');
    return 0;
  }

  switch (key) {
    case 'bot_token':
      out(`${cfg.bot_token}\n`);
      return 0;
    case 'chat_id':
      out(`${cfg.chat_id}\n`);
      return 0;
    case 'enabled':
      out(`${cfg.enabled ? 'true' : 'false'}\n`);
      return 0;
    case 'min_duration':
      out(`${cfg.min_duration}\n`);
      return 0;
    case 'scope':
      out(`${cfg.scope}\n`);
      return 0;
    default:
      error(`알 수 없는 키: ${key} (사용 가능: bot_token, chat_id, enabled, min_duration, scope)`);
      return 1;
  }
}

// ─── status ───
function cmdStatus(): number {
  out('\n');
  out(`${BOLD}=== Telegram 메신저 설정 상태 ===${RESET}\n`);
  out('\n');

  const cfg = readConfig();
  if (!cfg) {
    warn(`설정 파일 없음: ${CONFIG_FILE()}`);
    out('\n');
    info('설정하려면: messenger.sh config <bot_token> <chat_id>');
    return 0;
  }

  const maskedToken = cfg.bot_token ? `${cfg.bot_token.slice(0, 10)}...(마스킹됨)` : '(비어있음)';

  // padByte(14)는 bash `printf "%-14s"` 의 바이트 기준 폭을 재현한다 (format.ts 참조).
  out(`  ${padByte('bot_token:', 14)} ${maskedToken}\n`);
  out(`  ${padByte('chat_id:', 14)} ${cfg.chat_id || "'(비어있음)'"}\n`);
  out(`  ${padByte('enabled:', 14)} `);
  out(cfg.enabled ? `${GREEN}활성화${RESET}\n` : `${YELLOW}비활성화${RESET}\n`);
  if (cfg.min_duration > 0) {
    out(`  ${padByte('min_duration:', 14)} ${cfg.min_duration}초 (${formatDuration(cfg.min_duration)})\n`);
  } else {
    out(`  ${padByte('min_duration:', 14)} 제한 없음\n`);
  }
  out(`  ${padByte('scope:', 14)} ${cfg.scope || 'global'}\n`);
  out(`  ${padByte('설정 파일:', 14)} ${CONFIG_FILE()}\n`);
  out('\n');
  return 0;
}

// ─── DB 경로 탐색 (bash find_db 동등) ───
function findDb(): string | null {
  let projRoot = '';
  try {
    projRoot = readFileSync(join(process.cwd(), '.claude/.project_root'), 'utf8').trim();
  } catch {
    // 파일 없음 — git으로 폴백
  }
  if (!projRoot) {
    try {
      projRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // git 저장소 아님
    }
  }
  if (!projRoot) projRoot = '.';

  const db = join(projRoot, '.claude/db/context.db');
  return existsSync(db) ? db : null;
}

/** epoch(초) → 로컬 시각 문자열. bash `date -r <epoch> "+<fmt>"` 동등. */
function formatEpoch(epoch: number, withDate: boolean): string {
  const d = new Date(epoch * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  if (!withDate) return time;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
}

const nowEpoch = (): number => Math.floor(Date.now() / 1000);

/**
 * bash `read -t 1 -r stdin_data` 동등 — 첫 줄만, 1초 상한.
 * TTY면 보낼 데이터가 없으므로 즉시 반환한다 (기다리면 행 걸림).
 */
async function readStdinLine(timeoutMs = 1000): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) return '';

  return await new Promise<string>((resolve) => {
    let data = '';
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.removeAllListeners('data');
      stdin.removeAllListeners('end');
      stdin.removeAllListeners('error');
      try {
        stdin.pause();
      } catch {
        // 무시
      }
      resolve(data.split('\n')[0] ?? '');
    };
    const timer = setTimeout(finish, timeoutMs);
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      data += chunk;
      if (data.includes('\n')) finish();
    });
    stdin.on('end', finish);
    stdin.on('error', finish);
  });
}

/** scope=project 이면 현재 프로젝트에 .messenger_enabled 가 있어야 한다. */
function checkScope(scope: string): boolean {
  if (scope !== 'project') return true;
  let projRoot = '';
  try {
    projRoot = readFileSync(join(process.cwd(), '.claude/.project_root'), 'utf8').trim();
  } catch {
    // 폴백
  }
  if (!projRoot) {
    try {
      projRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // 무시
    }
  }
  if (!projRoot) projRoot = '.';
  return existsSync(join(projRoot, '.claude/.messenger_enabled'));
}

/** notify가 DB에서 긁어오는 값들. */
interface NotifyFacts {
  startTimeStr: string;
  elapsedSec: number;
  filesCount: string;
  resultLine: string;
}

/** bash cmd_notify의 DB 조회부를 그대로 옮긴 것. 실패는 전부 삼킨다. */
function gatherFacts(dbPath: string): NotifyFacts {
  const facts: NotifyFacts = { startTimeStr: '', elapsedSec: 0, filesCount: '0', resultLine: '' };
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);

    const startRow = db
      .prepare("SELECT COALESCE(value,'0') AS v FROM live_context WHERE key='messenger_prompt_time'")
      .get() as { v: string } | undefined;
    const startEpoch = Number(startRow?.v ?? 0) || 0;

    if (startEpoch > 0) {
      facts.startTimeStr = formatEpoch(startEpoch, false);
      facts.elapsedSec = nowEpoch() - startEpoch;

      // prompt 이후 편집된 고유 파일 수
      const promptDt = formatEpoch(startEpoch, true);
      const cnt = db
        .prepare(
          `SELECT COUNT(DISTINCT file_path) AS n FROM tool_usage
           WHERE tool_name IN ('Edit','Write')
             AND file_path IS NOT NULL
             AND timestamp >= ?`
        )
        .get(promptDt) as { n: number } | undefined;
      facts.filesCount = String(cnt?.n ?? 0);
    }

    // 결과내용: current_task → key_findings → session_summary → 최근 편집 파일
    const pick = (key: string): string => {
      const row = db!
        .prepare("SELECT value AS v FROM live_context WHERE key=? AND value != '' LIMIT 1")
        .get(key) as { v: string } | undefined;
      return row?.v ?? '';
    };
    let result = pick('current_task') || pick('key_findings') || pick('session_summary');

    if (!result) {
      const row = db
        .prepare(
          `SELECT GROUP_CONCAT(DISTINCT REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '/', '')), '')) AS v
           FROM (SELECT file_path FROM tool_usage
                 WHERE tool_name IN ('Edit','Write') AND file_path IS NOT NULL
                 ORDER BY timestamp DESC LIMIT 5)`
        )
        .get() as { v: string | null } | undefined;
      const recent = row?.v ?? '';
      if (recent) result = `편집: ${recent}`;
    }

    // 첫 줄만 사용 + 80자 제한
    result = result.split('\n')[0] ?? '';
    if (result.length > 80) result = `${result.slice(0, 77)}...`;
    facts.resultLine = result;
  } catch {
    // DB 접근 실패 — 기본값으로 진행 (알림은 보내야 한다)
  } finally {
    try {
      db?.close();
    } catch {
      // 무시
    }
  }
  return facts;
}

// ─── notify (Stop hook 전용) ───
async function cmdNotify(): Promise<number> {
  const cfg = readConfig();
  if (!cfg) return 0;
  if (!cfg.bot_token || !cfg.chat_id) return 0;
  if (!cfg.enabled) return 0;

  // 중복 방지: 마지막 알림 후 30초 이내면 스킵
  const dedupFile = join(homeDir(), '.claude', '.messenger_last_notify');
  const now = nowEpoch();
  try {
    const last = Number(readFileSync(dedupFile, 'utf8').trim()) || 0;
    if (now > 0 && last > 0 && now - last < 30) return 0;
  } catch {
    // 파일 없음 — 첫 알림
  }
  try {
    writeFileSync(dedupFile, `${now}\n`);
  } catch {
    // 무시
  }

  const stdinData = await readStdinLine();
  let stopReason = 'completed';
  if (stdinData) {
    try {
      const payload = JSON.parse(stdinData) as { reason?: unknown };
      if (typeof payload.reason === 'string' && payload.reason) stopReason = payload.reason;
    } catch {
      // 파싱 실패 — 기본값 유지
    }
  }

  const projectPath = process.cwd();
  const dbPath = findDb();
  const facts = dbPath ? gatherFacts(dbPath) : { startTimeStr: '', elapsedSec: 0, filesCount: '0', resultLine: '' };

  // min_duration 체크
  if (cfg.min_duration > 0 && facts.elapsedSec > 0 && facts.elapsedSec < cfg.min_duration) return 0;
  // scope 체크
  if (!checkScope(cfg.scope || 'global')) return 0;

  const durationStr = formatDuration(facts.elapsedSec);
  const endTime = formatEpoch(nowEpoch(), false);
  const startTimeStr = facts.startTimeStr || endTime;
  const resultLine = facts.resultLine || '작업 완료';

  const message = `[dotclaude]
프로젝트: ${projectPath}
상태: ${stopReason}
시작: ${startTimeStr}
종료: ${endTime}
소요: ${durationStr}
파일: ${facts.filesCount}개
결과: ${resultLine}`;

  // 평문 메시지다 → 통째로 이스케이프해도 서식 손상이 없다.
  // (구 구현은 이 경로에서 current_task의 '<'/'&' 때문에 400을 맞고 알림을 잃었다)
  await sendMessage(cfg.bot_token, cfg.chat_id, escapeHtml(message));
  return 0;
}

// ─── prompt-time (UserPromptSubmit hook 전용) ───
function cmdPromptTime(): number {
  const dbPath = findDb();
  if (!dbPath) return 0;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    db.prepare(
      "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('messenger_prompt_time', ?, datetime('now','localtime'))"
    ).run(String(nowEpoch()));
  } catch {
    // 훅 경로 — 실패해도 조용히 넘어간다
  } finally {
    try {
      db?.close();
    } catch {
      // 무시
    }
  }
  return 0;
}

// ─── 메인 진입점 ───
export async function main(argv: string[]): Promise<number> {
  const [subcommand, ...args] = argv;

  switch (subcommand) {
    case 'config':
      return cmdConfig(args);
    case 'test':
      return await cmdTest();
    case 'on':
      return cmdToggle(true);
    case 'off':
      return cmdToggle(false);
    case 'send':
      return await cmdSend(args);
    case 'status':
      return cmdStatus();
    case 'notify':
      return await cmdNotify();
    case 'set':
      return cmdSet(args);
    case 'get':
      return cmdGet(args);
    case 'prompt-time':
      return cmdPromptTime();
    case undefined:
    case '':
    case '-h':
    case '--help':
    case 'help':
      showHelp();
      return 0;
    default:
      error(`알 수 없는 서브커맨드: ${subcommand}`);
      showHelp();
      return 1;
  }
}

// process.exit()를 쓰지 않는다 — 파이프로 연결된 stdout이 잘릴 수 있다.
// exitCode만 세팅하면 node가 큐를 비운 뒤 정상 종료한다.
process.exitCode = await main(process.argv.slice(2));
