/**
 * PostToolUse(Bash) 훅 — 에러 로깅 회귀 테스트
 *
 * 배경: post-bash.ts가 최상위 input.stdout/stderr을 읽었으나, 실제 페이로드는
 * tool_response 하위에 중첩돼 있다. 그 결과 combined가 항상 ''이 되어
 * 조기 리턴 → errors 테이블이 4개월간 0행이었다.
 *
 * 이 테스트는 실측 픽스처(test/fixtures/post-tool-use-bash.jsonl)의 구조를 기준으로
 * (1) 중첩 경로를 읽어 에러를 감지하고 (2) 구(舊) 최상위 형태로는 감지되지 않음을 확인한다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handlePostBash } from '../src/hooks/events/post-bash.ts';
import { createFakeDB } from './helpers/fake-db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'post-tool-use-bash.jsonl');

/** 실측 픽스처 레코드를 로드한다. */
function loadFixtureRecords() {
  return readFileSync(FIXTURE, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

/** 실제 도구가 뱉는 형태의 빌드 실패 출력. */
const BUILD_ERROR_OUTPUT =
  'error: build failed with 1 error:\n' +
  "src/app.ts:3:10: ERROR: Could not resolve './missing'\n";

const PROJECT_ROOT = '/Users/testuser/work/dotclaude';

describe('실측 페이로드 구조', () => {
  test('픽스처의 stdout/stderr은 tool_response 하위에만 존재한다', () => {
    const records = loadFixtureRecords();
    assert.ok(records.length > 0, '픽스처가 비어 있으면 안 된다');

    for (const rec of records) {
      // 이 두 줄이 버그의 핵심: 최상위에는 stdout/stderr이 없다.
      assert.equal('stdout' in rec, false, '최상위 stdout은 존재하지 않는다');
      assert.equal('stderr' in rec, false, '최상위 stderr은 존재하지 않는다');

      assert.ok(rec.tool_response, 'tool_response는 존재한다');
      assert.equal(typeof rec.tool_response.stdout, 'string');
      assert.equal(typeof rec.tool_response.stderr, 'string');
      assert.equal(typeof rec.tool_response.interrupted, 'boolean');
      assert.equal(typeof rec.tool_response.isImage, 'boolean');
      assert.equal(typeof rec.tool_response.noOutputExpected, 'boolean');
      assert.equal(rec.hook_event_name, 'PostToolUse');
      assert.equal(rec.tool_name, 'Bash');
    }
  });
});

describe('에러 감지 (버그 수정 증명)', () => {
  test('실측 구조(tool_response.stderr)의 에러를 감지해 errors에 기록한다', async () => {
    // 실측 픽스처 레코드를 그대로 쓰되, 실패 출력만 주입한다.
    const [real] = loadFixtureRecords();
    const payload = {
      ...real,
      tool_response: { ...real.tool_response, stdout: '', stderr: BUILD_ERROR_OUTPUT },
    };

    const db = createFakeDB();
    await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: JSON.stringify(payload) });

    // 수정 전 코드는 여기서 0건이었다 (조기 리턴).
    assert.equal(db.calls.errorLog.length, 1, '중첩 경로의 에러가 감지되어야 한다');
    assert.equal(db.calls.errorLog[0].errorType, 'build_fail');
    assert.equal(db.calls.liveSet.length, 1, 'error_context가 저장되어야 한다');
    assert.equal(db.calls.liveSet[0].key, 'error_context');
  });

  test('tool_response.stdout에 담긴 에러도 감지한다', async () => {
    const [real] = loadFixtureRecords();
    const payload = {
      ...real,
      tool_response: { ...real.tool_response, stdout: BUILD_ERROR_OUTPUT, stderr: '' },
    };

    const db = createFakeDB();
    await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: JSON.stringify(payload) });

    assert.equal(db.calls.errorLog.length, 1);
    assert.equal(db.calls.errorLog[0].errorType, 'build_fail');
  });

  test('구(舊) 형태(최상위 stderr)로는 감지되지 않는다 — 중첩 경로만 읽는다', async () => {
    const [real] = loadFixtureRecords();
    // 존재하지 않는 옛 가정: 최상위 stdout/stderr. tool_response는 비운다.
    const legacyPayload = {
      ...real,
      stdout: '',
      stderr: BUILD_ERROR_OUTPUT,
      tool_response: { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false },
    };

    const db = createFakeDB();
    await handlePostBash({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: JSON.stringify(legacyPayload),
    });

    assert.equal(db.calls.errorLog.length, 0, '최상위 경로는 더 이상 참조하지 않는다');
    assert.equal(db.calls.liveSet.length, 0);
  });

  test('에러 종류를 분류한다 (test_fail / permission)', async () => {
    const [real] = loadFixtureRecords();
    const cases = [
      { output: 'npm ERR! Test failed. See above for more details.', expected: 'test_fail' },
      { output: 'cp: /etc/hosts: Permission denied — error', expected: 'permission' },
    ];

    for (const { output, expected } of cases) {
      const payload = {
        ...real,
        tool_response: { ...real.tool_response, stdout: '', stderr: output },
      };
      const db = createFakeDB();
      await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: JSON.stringify(payload) });
      assert.equal(db.calls.errorLog[0]?.errorType, expected, `분류 실패: ${output}`);
    }
  });
});

describe('정상 종료 및 방어', () => {
  test('성공한 명령(에러 키워드 없음)은 아무것도 기록하지 않는다', async () => {
    const [real] = loadFixtureRecords();
    const payload = {
      ...real,
      tool_response: { ...real.tool_response, stdout: 'build succeeded in 1.2s\n', stderr: '' },
    };

    const db = createFakeDB();
    await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: JSON.stringify(payload) });

    assert.equal(db.calls.errorLog.length, 0);
  });

  test('빈 stdin / 잘못된 JSON / tool_response 누락에도 throw하지 않는다', async () => {
    const db = createFakeDB();
    // 훅 실패가 Claude를 막으면 안 되므로 조용히 반환해야 한다.
    await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: '' });
    await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: 'not json{{' });
    await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: '{}' });
    await handlePostBash({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: JSON.stringify({ tool_response: null }),
    });

    assert.equal(db.calls.errorLog.length, 0);
  });
});

describe('분류기 확장 (구 특성 테스트의 한계를 해소)', () => {
  test('실측 레코드0의 에러 출력을 이제 감지한다', async () => {
    // 구 게이트 /error|failed|fatal/는 이 출력("cannot access ... No such file or
    // directory" + 한국어)을 놓쳤고, 그 사실을 특성 테스트로 문서화해 두었다.
    // 분류기를 확장했으므로 이제는 감지된다 — 특성 테스트를 새 동작으로 갱신한다.
    // 레코드0은 exit 0으로 끝나지만 에러 문구를 출력한 명령이라, 성공 경로
    // 게이트가 정확히 잡아야 하는 사례다.
    const [real] = loadFixtureRecords();
    const db = createFakeDB();
    await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: JSON.stringify(real) });

    assert.equal(db.calls.errorLog.length, 1, '구 게이트가 놓치던 출력이 감지된다');
    assert.equal(db.calls.errorLog[0].errorType, 'runtime_error');
  });
});

describe('오탐 방지 (성공 경로 게이트)', () => {
  // 성공 경로는 게이트만 믿는다. 여기서 넓히면 가짜 행이 쌓인다 —
  // errors 테이블의 과거 37행이 전부 이 오탐이었다.
  const benign = [
    'Found 0 errors.\n',
    'tests 50\npass 50\nfail 0\n',
    '0 tests failed\n',
    'Compiling project...\ndone\n',
    'nothing to commit, working tree clean\n',
  ];

  for (let i = 0; i < benign.length; i++) {
    test(`정상 출력 ${i + 1}번은 기록하지 않는다`, async () => {
      const [real] = loadFixtureRecords();
      const payload = {
        ...real,
        tool_response: { ...real.tool_response, stdout: benign[i], stderr: '' },
      };

      const db = createFakeDB();
      await handlePostBash({ projectRoot: PROJECT_ROOT, db, stdinData: JSON.stringify(payload) });

      assert.equal(db.calls.errorLog.length, 0, `오탐: ${JSON.stringify(benign[i])}`);
      assert.equal(db.calls.liveSet.length, 0);
    });
  }
});
