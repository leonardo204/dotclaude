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
 * notify/prompt-time의 실질 경로는 이제 통합 Stop 훅(hooks/events/stop.ts)과
 * prompt 훅이다. 두 서브커맨드는 CLI 표면 호환을 위해 남으며, 조립 규칙이
 * 두 벌 생기지 않도록 본체는 notify.ts에 위임한다.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ContextDB } from '../shared/db.js';
import { configPath, readConfig, writeConfig, type MessengerConfig } from './config.js';
import { escapeHtml, formatDuration, padByte } from './format.js';
import { nowEpoch, runStopNotify } from './notify.js';
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

// ─── 프로젝트 루트 / DB 경로 탐색 (bash find_db 동등) ───
function findProjectRoot(): string {
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
  return projRoot || '.';
}

function findDb(projRoot: string = findProjectRoot()): string | null {
  const db = join(projRoot, '.claude/db/context.db');
  return existsSync(db) ? db : null;
}

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

/**
 * ─── notify ───
 *
 * 실질 경로는 통합 Stop 훅(hooks/events/stop.ts)이다. 이 서브커맨드는 CLI 표면 호환용으로
 * 남아 있고, 재료 수집·조립·게이트는 전부 notify.ts에 위임한다.
 *
 * 구 구현과의 차이 두 가지:
 *   1) `.reason` 파싱 폐기 — Stop 페이로드에 그런 필드는 **없다**(실측). 늘 'completed' 상수였다.
 *      진짜 상태는 last_assistant_message에서 온다.
 *   2) 조립 로직 중복 제거 — 여기에 있던 gatherFacts/checkScope는 notify.ts로 옮겼다.
 */
async function cmdNotify(): Promise<number> {
  const stdinData = await readStdinLine();
  const projRoot = findProjectRoot();
  const dbPath = findDb(projRoot);

  let db: ContextDB | null = null;
  try {
    if (dbPath) db = new ContextDB(dbPath);
  } catch {
    // DB 없이도 알림은 나간다 (재료 부재는 섹션 생략일 뿐이다)
  }

  let stop = {};
  if (stdinData) {
    try {
      stop = JSON.parse(stdinData) as Record<string, unknown>;
    } catch {
      // 파싱 실패 — 재료 없이 진행
    }
  }

  try {
    await runStopNotify({ db, projectRoot: projRoot, stop });
  } finally {
    try {
      db?.close();
    } catch {
      // 무시
    }
  }
  return 0;
}

/**
 * ─── prompt-time ───
 *
 * 실질 경로는 prompt 훅(hooks/events/prompt.ts)이 흡수했다 — 매 턴 bash 포크가 사라졌다.
 * CLI 표면 호환을 위해 남긴다. 키 이름은 notify와의 계약이므로 그대로다.
 */
function cmdPromptTime(): number {
  const dbPath = findDb();
  if (!dbPath) return 0;
  let db: ContextDB | null = null;
  try {
    db = new ContextDB(dbPath);
    db.liveSet('messenger_prompt_time', String(nowEpoch()));
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
