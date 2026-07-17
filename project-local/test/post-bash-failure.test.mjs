/**
 * PostToolUseFailure(Bash) 훅 — 실패 기록 테스트
 *
 * 배경: 이 하니스는 진짜 실패를 단 한 번도 기록한 적이 없다.
 * PostToolUse는 공식 문서상 "After a tool call succeeds"라, 실패한 명령은
 * post-bash.ts에 도달조차 하지 않았다 (exit 2 명령으로 실측 확인).
 * 실패는 PostToolUseFailure로 오며, 페이로드 구조가 다르다:
 * tool_response가 없고 error 문자열 하나에 담긴다.
 *
 * 주의: 에러 문자열을 test 이름에 넣지 마라 (npm test 출력이 훅을 통과한다).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handlePostBashFailure } from '../src/hooks/events/post-bash-failure.ts';
import { createFakeDB } from './helpers/fake-db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'post-tool-use-failure-bash.jsonl');

/** 실측 픽스처 레코드를 로드한다. */
function loadFixtureRecords() {
  return readFileSync(FIXTURE, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

const PROJECT_ROOT = '/Users/testuser/work/dotclaude';

async function run(payload, db = createFakeDB()) {
  await handlePostBashFailure({
    projectRoot: PROJECT_ROOT,
    db,
    stdinData: JSON.stringify(payload),
  });
  return db;
}

describe('실측 페이로드 구조 (PostToolUse와 다르다)', () => {
  test('tool_response가 없고 error/is_interrupt/duration_ms가 있다', () => {
    const records = loadFixtureRecords();
    assert.ok(records.length > 0, '픽스처가 비어 있으면 안 된다');

    for (const rec of records) {
      assert.equal(rec.hook_event_name, 'PostToolUseFailure');
      assert.equal(rec.tool_name, 'Bash');
      // 핵심: 성공 이벤트와 구조가 다르다. 여기서 tool_response를 읽으면 안 된다.
      assert.equal('tool_response' in rec, false, 'tool_response는 존재하지 않는다');
      assert.equal('stdout' in rec, false);
      assert.equal('stderr' in rec, false);
      assert.equal(typeof rec.error, 'string');
      assert.equal(typeof rec.is_interrupt, 'boolean');
      assert.equal(typeof rec.duration_ms, 'number');
    }
  });

  test('error 첫 줄은 종료 코드, 이후는 실제 출력이다', () => {
    const [rec] = loadFixtureRecords();
    const [first, ...rest] = rec.error.split('\n');

    assert.match(first, /^Exit code \d+$/);
    assert.ok(rest.join('\n').length > 0, '실제 에러 출력이 뒤따른다');
  });
});

describe('실패 기록 (실측 픽스처)', () => {
  test('실측 실패 페이로드를 errors 1행으로 기록한다', async () => {
    const [real] = loadFixtureRecords();
    const db = await run(real);

    // 이 하니스 역사상 처음으로 진짜 실패가 기록되는 지점.
    assert.equal(db.calls.errorLog.length, 1, '실패는 무조건 기록되어야 한다');
    assert.equal(db.calls.liveSet.length, 1);
    assert.equal(db.calls.liveSet[0].key, 'error_context');
  });

  test('실측 픽스처의 종료 코드 2가 error_context에 반영된다', async () => {
    const [real] = loadFixtureRecords();
    const db = await run(real);

    assert.match(db.calls.liveSet[0].value, /\(exit 2\)/);
  });

  test('컬럼 의미대로 저장한다 (레거시 오용 회귀 방지)', async () => {
    // 레거시는 error_type 자리에 'Bash'를, file_path 자리에 에러 타입을 넣었다.
    const [real] = loadFixtureRecords();
    const db = await run(real);
    const [logged] = db.calls.errorLog;

    assert.equal(logged.errorType, 'runtime_error', 'error_type은 카테고리다');
    assert.notEqual(logged.errorType, 'Bash', "error_type에 도구명이 들어가면 안 된다");
    // 이 출력엔 파일 경로가 없다 → undefined (에러 타입을 넣지 않는다).
    assert.equal(logged.filePath, undefined, 'file_path에 에러 타입을 넣지 않는다');
    assert.equal(logged.resolution, undefined);
  });

  test('감지 게이트 없이 분류만 한다 (실패는 확정)', async () => {
    // 에러 키워드가 전혀 없는 실패 출력도 기록되어야 한다.
    const [real] = loadFixtureRecords();
    const db = await run({ ...real, error: 'Exit code 1\n알 수 없는 이유로 죽었다' });

    assert.equal(db.calls.errorLog.length, 1, '분류 불가여도 기록한다');
    assert.equal(db.calls.errorLog[0].errorType, 'runtime_error');
    assert.match(db.calls.liveSet[0].value, /\(exit 1\)/);
  });

  test('출력 내용에 따라 카테고리를 나눠 기록한다', async () => {
    const [real] = loadFixtureRecords();
    const cases = [
      ['Exit code 1\nerror: build failed with 1 error:', 'build_fail'],
      ['Exit code 1\nnpm ERR! Test failed. See above.', 'test_fail'],
      ['Exit code 1\ncp: /etc/hosts: Permission denied', 'permission'],
      ['Exit code 127\nbash: foo: command not found', 'runtime_error'],
      ['Exit code 139\nSegmentation fault: 11', 'runtime_error'],
      ['Exit code 137\nKilled: 9', 'runtime_error'],
    ];

    for (const [error, expected] of cases) {
      const db = await run({ ...real, error });
      assert.equal(db.calls.errorLog.length, 1);
      assert.equal(db.calls.errorLog[0].errorType, expected, `분류 실패: ${expected}`);
    }
  });

  test('에러 출력의 파일 경로를 file_path로 뽑는다', async () => {
    const [real] = loadFixtureRecords();
    const db = await run({
      ...real,
      error: 'Exit code 2\nsrc/app.ts:3:10: ERROR: Could not resolve ./missing',
    });

    assert.equal(db.calls.errorLog[0].filePath, 'src/app.ts');
  });
});

describe('사용자 중단은 에러가 아니다', () => {
  test('is_interrupt=true면 기록하지 않는다', async () => {
    // 실측 픽스처를 그대로 쓰되 중단 플래그만 뒤집는다 (ESC 취소 상황).
    const [real] = loadFixtureRecords();
    const db = await run({ ...real, is_interrupt: true });

    assert.equal(db.calls.errorLog.length, 0, 'ESC 취소는 실패가 아니다');
    assert.equal(db.calls.liveSet.length, 0, '알림 스팸 방지');
  });

  test('is_interrupt=false면 정상적으로 기록한다', async () => {
    const [real] = loadFixtureRecords();
    const db = await run({ ...real, is_interrupt: false });

    assert.equal(db.calls.errorLog.length, 1);
  });
});

describe('정상 종료 및 방어', () => {
  test('빈 stdin / 잘못된 JSON / error 누락에도 throw하지 않는다', async () => {
    const db = createFakeDB();
    // 훅 실패가 Claude를 막으면 안 되므로 조용히 반환해야 한다.
    await handlePostBashFailure({ projectRoot: PROJECT_ROOT, db, stdinData: '' });
    await handlePostBashFailure({ projectRoot: PROJECT_ROOT, db, stdinData: 'not json{{' });
    await handlePostBashFailure({ projectRoot: PROJECT_ROOT, db, stdinData: '{}' });
    await handlePostBashFailure({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: JSON.stringify({ error: null }),
    });

    assert.equal(db.calls.errorLog.length, 0, 'error가 없는 페이로드는 기록하지 않는다');
  });

  test('DB가 던져도 훅은 조용히 넘어간다', async () => {
    const [real] = loadFixtureRecords();
    const db = createFakeDB();
    db.errorLog = () => {
      throw new Error('db is locked');
    };

    // throw가 새어 나가면 훅이 Claude 사용을 막는다.
    await handlePostBashFailure({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: JSON.stringify(real),
    });
  });

  test('error가 빈 문자열이어도 실패는 실패다', async () => {
    const [real] = loadFixtureRecords();
    const db = await run({ ...real, error: '' });

    assert.equal(db.calls.errorLog.length, 1);
    assert.equal(db.calls.errorLog[0].errorType, 'runtime_error');
  });
});
