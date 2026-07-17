/**
 * 에러 감지 게이트 · 분류기 테스트
 *
 * 배경: 구 분류기는 /error|failed|fatal/ 게이트를 통과해야만 분류에 도달해
 * 실제 에러 9종 중 6종을 놓쳤다. 동시에 게이트가 단어 단위라 "Found 0 errors" 같은
 * 성공 출력까지 잡아 errors 테이블에 가짜 37행을 남겼다.
 * 그중 19행은 페이로드에 항상 존재하는 permission_mode 문자열이 구 분류기의
 * /permission/ 분기에 걸려 permission으로 오분류된 것이었다.
 *
 * 주의: 에러 문자열을 test 이름에 넣지 마라. npm test 출력(exit 0)이 그대로
 * PostToolUse 훅을 통과하므로, 테스트 이름 자체가 오탐을 유발한다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyError,
  looksLikeError,
  parseExitCode,
} from '../src/hooks/error-classify.ts';

/** 구 분류기가 놓쳤던 6종 (실측). [입력, 기대 카테고리] */
const PREVIOUSLY_MISSED = [
  ["ls: cannot access '/nope': No such file or directory", 'runtime_error'],
  ['bash: foo: command not found', 'runtime_error'],
  ['Permission denied', 'permission'],
  ['npm ERR! code ENOENT', 'runtime_error'],
  ['Segmentation fault: 11', 'runtime_error'],
  ['Killed: 9', 'runtime_error'],
];

/** 구 분류기도 잡던 3종 — 회귀 금지. */
const ALREADY_DETECTED = [
  ['fatal: not a git repository', 'runtime_error'],
  ["error TS2304: Cannot find name 'foo'", 'build_fail'],
  ['✗ 3 tests failed', 'test_fail'],
];

/**
 * 게이트가 절대 반응하면 안 되는 정상 출력.
 * 성공(exit 0) 경로는 이 게이트만 믿으므로 오탐이 곧 가짜 행이 된다.
 */
const BENIGN_OUTPUT = [
  'Found 0 errors.',
  'build succeeded in 1.2s',
  'tests 50\npass 50\nfail 0',
  '0 tests failed',
  '0 errors, 0 warnings',
  // 가짜 19행의 원흉 — 페이로드에 항상 들어 있는 문자열이다.
  'permission_mode: bypassPermissions',
  'error_context: none',
  'Checking file permissions...',
  'ERROR_COUNT=0',
  'All tests passed',
  'Compiling project...',
  'nothing to commit, working tree clean',
];

describe('감지 게이트 (PostToolUse 성공 경로)', () => {
  test('구 게이트가 놓친 6종을 모두 감지한다', () => {
    for (const [output] of PREVIOUSLY_MISSED) {
      assert.equal(looksLikeError(output), true, `감지 실패: ${JSON.stringify(output)}`);
    }
  });

  test('기존에 감지되던 3종도 계속 감지한다 (회귀 금지)', () => {
    for (const [output] of ALREADY_DETECTED) {
      assert.equal(looksLikeError(output), true, `회귀: ${JSON.stringify(output)}`);
    }
  });

  test('정상 출력에는 반응하지 않는다 (오탐 방지)', () => {
    for (const output of BENIGN_OUTPUT) {
      assert.equal(looksLikeError(output), false, `오탐: ${JSON.stringify(output)}`);
    }
  });

  test('구 게이트를 통과시키던 흔한 단어만으로는 걸리지 않는다', () => {
    // "error"/"failed"/"fatal"이 문맥 없이 등장하는 경우.
    assert.equal(looksLikeError('no errors were found'), false);
    assert.equal(looksLikeError('the failed_count field is 0'), false);
    assert.equal(looksLikeError('src/error-classify.ts'), false);
  });
});

describe('분류', () => {
  test('구 분류기가 놓친 6종이 의도한 카테고리로 분류된다', () => {
    for (const [output, expected] of PREVIOUSLY_MISSED) {
      assert.equal(classifyError(output), expected, `분류 실패: ${JSON.stringify(output)}`);
    }
  });

  test('기존 3종의 분류가 유지된다', () => {
    for (const [output, expected] of ALREADY_DETECTED) {
      assert.equal(classifyError(output), expected, `분류 회귀: ${JSON.stringify(output)}`);
    }
  });

  test('permission_mode 문자열은 더 이상 permission으로 오분류되지 않는다', () => {
    // 구 분류기: /permission/ → permission (가짜 19행의 원인).
    // 신 분류기는 "permission denied" 구문을 요구한다.
    assert.notEqual(classifyError('permission_mode: bypassPermissions'), 'permission');
    assert.equal(classifyError('cp: /etc/hosts: Permission denied'), 'permission');
    assert.equal(classifyError('mkdir: EACCES: permission denied'), 'permission');
  });

  test('경로에 test가 들어 있어도 test_fail로 오분류되지 않는다', () => {
    // 구 분류기는 /test/ 단어 하나로 판단해 이런 경로를 test_fail로 만들었다.
    assert.equal(
      classifyError("ls: /src/test/data.json: No such file or directory"),
      'runtime_error'
    );
  });

  test('빌드/테스트/머지 실패를 구분한다', () => {
    assert.equal(classifyError('error: build failed with 1 error:'), 'build_fail');
    assert.equal(classifyError('npm ERR! Test failed. See above.'), 'test_fail');
    assert.equal(
      classifyError('CONFLICT (content): Merge conflict in src/app.ts'),
      'conflict'
    );
    assert.equal(classifyError('Automatic merge failed; fix conflicts'), 'conflict');
  });

  test('어디에도 걸리지 않으면 runtime_error로 폴백한다', () => {
    // 실패가 확정된 경로(PostToolUseFailure)에서 분류 불가가 곧 무기록이 되면 안 된다.
    assert.equal(classifyError('Exit code 1'), 'runtime_error');
    assert.equal(classifyError(''), 'runtime_error');
    assert.equal(classifyError('무슨 일이 일어났는지 알 수 없음'), 'runtime_error');
  });
});

describe('exit code 파싱', () => {
  test('첫 줄에서 종료 코드를 뽑는다', () => {
    assert.equal(
      parseExitCode("Exit code 2\nls: cannot access '/nope': No such file or directory"),
      2
    );
    assert.equal(parseExitCode('Exit code 127'), 127);
    assert.equal(parseExitCode('Exit code 0'), 0);
  });

  test('형식이 다르면 null을 반환한다 (호출부는 기록을 계속해야 한다)', () => {
    assert.equal(parseExitCode(''), null);
    assert.equal(parseExitCode('boom'), null);
    // 첫 줄이 아니면 파싱하지 않는다.
    assert.equal(parseExitCode('something\nExit code 2'), null);
  });
});
