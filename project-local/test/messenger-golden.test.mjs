/**
 * 골든 대조 — messenger CLI 하위 호환 회귀 방지
 *
 * 배경: messenger.sh(bash 596줄)를 TS로 옮겼다. CLI는 슬래시 명령
 * /dotclaude-messenger 와 settings.json 훅이 의존하는 **공개 표면**이므로
 * 출력 한 바이트, 종료 코드 하나가 달라져도 하위 호환이 깨진다.
 * test/golden/ 의 기준선은 **전환 전 bash**로 캡처한 실제 출력이다 (README 참조).
 *
 * 왜 서브프로세스인가: 검증 대상이 argv → stdout/stderr → exit code 라는
 * 프로세스 경계 그 자체다. main()을 직접 부르면 종료 코드와 스트림 병합을 못 본다.
 *
 * 왜 dist가 아니라 src인가: npm test가 npm run build 선행에 의존하면
 * 빌드를 잊은 채 통과하는 순간이 생긴다. src를 직접 돌려 그 결합을 끊는다.
 * (배포 산출물 dist는 build 스크립트가 같은 소스를 번들할 뿐이다)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolvePath(__dirname, '..');
const GOLDEN_DIR = join(__dirname, 'golden');
const CLI = join(PROJECT_ROOT, 'src/messenger/cli.ts');
const TS_RESOLVE = join(PROJECT_ROOT, 'test/helpers/ts-resolve.mjs');

/**
 * 골든을 캡처할 때 쓴 합성 설정 (test/golden/README.md와 동일해야 함).
 * 실제 사용자 설정(~/.claude/messenger.json)에 의존하지 않는다 = 밀폐.
 */
const SYNTHETIC_CONFIG = {
  bot_token: '1234567890:TEST_TOKEN_NOT_REAL_AAAAAAAAAAAAAAAAAAA',
  chat_id: '999999999',
  enabled: true,
  min_duration: 300,
  scope: 'global',
};

let fakeHome;
let configFile;

/**
 * HOME 의존 절대경로를 토큰으로 치환한다.
 *
 * 골든에는 캡처 당시 합성 HOME의 절대경로가 박혀 있고(status/help의 "설정 파일:" 줄),
 * 테스트는 매번 새 임시 HOME을 쓴다. 그 경로만 정규화하면 나머지는 바이트 대조가 된다.
 * 정규화 범위를 좁게 유지하려고 messenger.json 경로 하나만 치환한다.
 */
function normalize(text) {
  return text.replace(/\S*\/\.claude\/messenger\.json/g, '{CONFIG}');
}

/**
 * CLI를 서브프로세스로 실행하고 stdout+stderr **병합** 출력과 종료 코드를 돌려준다.
 *
 * 왜 파일 디스크립터를 공유하나: 골든은 `messenger.sh <cmd> > out 2>&1` 로 캡처됐다.
 * 즉 두 스트림이 같은 fd에 실시간으로 섞인다 — unknown 케이스는 error(stderr)가
 * help(stdout)보다 **먼저** 나온다. spawnSync가 주는 stdout/stderr를 나중에
 * 이어붙이면 이 순서가 뒤집혀, 통과시키려면 골든을 왜곡해야 한다.
 * 두 스트림을 같은 fd로 내보내 캡처 조건을 그대로 재현한다.
 */
function runCli(args) {
  const outFile = join(fakeHome, 'cli-out.tmp');
  const fd = openSync(outFile, 'w');
  try {
    const res = spawnSync(
      process.execPath,
      ['--import', TS_RESOLVE, '--disable-warning=ExperimentalWarning', CLI, ...args],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: fakeHome },
        // stdin=/dev/null (TTY 아님 = 훅 경로와 동일 조건), stdout/stderr는 같은 fd 공유
        stdio: ['ignore', fd, fd],
      }
    );
    return { out: readFileSync(outFile, 'utf8'), code: res.status };
  } finally {
    closeSync(fd);
  }
}

function readGolden(name) {
  return {
    text: readFileSync(join(GOLDEN_DIR, `${name}.txt`), 'utf8'),
    exit: Number(readFileSync(join(GOLDEN_DIR, `${name}.txt.exit`), 'utf8').trim()),
  };
}

before(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'messenger-golden-'));
  configFile = join(fakeHome, '.claude', 'messenger.json');
  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(SYNTHETIC_CONFIG, null, 2)}\n`, { mode: 0o600 });
});

after(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('messenger CLI 골든 대조', () => {
  /** 바이트 동일이 요구되는 조합. [골든 이름, argv] */
  const STRICT = [
    ['status', ['status']],
    ['get-enabled', ['get', 'enabled']],
    ['get-min_duration', ['get', 'min_duration']],
    ['get-scope', ['get', 'scope']],
    ['get-chat_id', ['get', 'chat_id']],
  ];

  for (const [name, argv] of STRICT) {
    test(`${name} — bash 기준선과 바이트 동일`, () => {
      const golden = readGolden(name);
      const actual = runCli(argv);
      assert.equal(normalize(actual.out), normalize(golden.text));
      assert.equal(actual.code, golden.exit);
    });
  }

  test('status — 색상 이스케이프 시퀀스가 bash와 동일하게 보존된다', () => {
    // 정규화가 우연히 이스케이프를 지워 통과하는 일이 없도록 존재 자체를 못박는다.
    const actual = runCli(['status']).out;
    assert.match(actual, /\x1b\[1m=== Telegram 메신저 설정 상태 ===\x1b\[0m/);
    assert.match(actual, /\x1b\[0;32m활성화\x1b\[0m/);
  });

  test('bot_token은 status에서 마스킹된다', () => {
    const actual = runCli(['status']).out;
    assert.match(actual, /1234567890\.\.\.\(마스킹됨\)/);
    assert.ok(
      !actual.includes(SYNTHETIC_CONFIG.bot_token),
      'status가 봇 토큰 전체를 노출하면 안 된다'
    );
  });
});

describe('messenger CLI 도움말 — 시크릿 유출 제거', () => {
  /**
   * help/unknown은 "의도된 변경"이다. 원본 messenger.sh:44의 예시에는
   * 실제 봇 토큰 앞부분과 실제 chat_id가 하드코딩돼 공개 repo에 커밋돼 있었다.
   * 기준선에서 placeholder로 치환해 뒀고, 아래 테스트가 실값 복귀를 막는다.
   */
  const CASES = [
    ['help', ['--help']],
    ['unknown', ['badcommand']],
  ];

  for (const [name, argv] of CASES) {
    test(`${name} — 구조가 기준선과 같다`, () => {
      const golden = readGolden(name);
      const actual = runCli(argv);
      assert.equal(normalize(actual.out), normalize(golden.text));
      assert.equal(actual.code, golden.exit);
    });

    test(`${name} — 실제 봇 토큰/chat_id가 없다`, () => {
      const actual = runCli(argv).out;
      // Telegram 봇 토큰 형태(<숫자>:<시크릿>)가 도움말에 있으면 실값 하드코딩이다.
      assert.ok(
        !/\b\d{8,}:[A-Za-z0-9_-]{10,}/.test(actual),
        '도움말에 봇 토큰 형태의 실값이 있으면 안 된다'
      );
      assert.match(actual, /<BOT_TOKEN>/);
      assert.match(actual, /<CHAT_ID>/);
    });
  }

  test('빈 인자 / -h / help 는 --help와 같은 출력', () => {
    const base = runCli(['--help']);
    for (const argv of [[], ['-h'], ['help']]) {
      const actual = runCli(argv);
      assert.equal(actual.out, base.out, `argv=${JSON.stringify(argv)}`);
      assert.equal(actual.code, 0);
    }
  });
});

describe('messenger CLI 하위 호환 — 기존 설정 파일', () => {
  test('읽기 전용 명령은 messenger.json을 수정하지 않는다', () => {
    // 요구사항: 기존 ~/.claude/messenger.json을 수정 없이 그대로 읽어야 한다.
    const before = readFileSync(configFile);
    for (const argv of [['status'], ['get', 'enabled'], ['get', 'scope'], ['--help']]) {
      runCli(argv);
    }
    assert.deepEqual(readFileSync(configFile), before);
  });

  test('알 수 없는 get 키는 종료 코드 1', () => {
    const actual = runCli(['get', 'nope']);
    assert.equal(actual.code, 1);
    assert.match(actual.out, /알 수 없는 키: nope/);
  });

  test('알 수 없는 set 키는 종료 코드 1', () => {
    const actual = runCli(['set', 'nope', '1']);
    assert.equal(actual.code, 1);
    assert.match(actual.out, /알 수 없는 설정 키: nope/);
  });

  test('set min_duration은 정수만 받는다', () => {
    const actual = runCli(['set', 'min_duration', 'abc']);
    assert.equal(actual.code, 1);
    assert.match(actual.out, /정수\(초\)여야 합니다/);
  });

  test('set scope는 global|project만 받는다', () => {
    const actual = runCli(['set', 'scope', 'nope']);
    assert.equal(actual.code, 1);
    assert.match(actual.out, /'global' 또는 'project'/);
  });
});
