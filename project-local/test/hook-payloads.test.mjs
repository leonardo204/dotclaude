/**
 * 훅 페이로드 계약 테스트 (실측 픽스처 기준)
 *
 * shared/types.ts의 타입 선언이 실제 페이로드와 어긋나지 않도록 고정한다.
 * 특히 Stop 페이로드에는 `reason` 필드가 존재하지 않는다 —
 * 과거 stop-ralph.ts의 dead `reason?: string` 선언이 소비처(messenger)의
 * 4개월짜리 버그를 유발했으므로, 추측 필드가 다시 스며들지 않게 못을 박는다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleStopRalph } from '../src/hooks/events/stop-ralph.ts';
import { captureStdout } from './helpers/fake-db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
}

const HOOK_BASE_FIELDS = ['session_id', 'transcript_path', 'cwd', 'prompt_id', 'hook_event_name'];

describe('Stop 페이로드 (stop.jsonl)', () => {
  test('공통 필드 + Stop 고유 필드가 실측대로 존재한다', () => {
    const [stop] = loadFixture('stop.jsonl');

    for (const f of HOOK_BASE_FIELDS) {
      assert.ok(f in stop, `공통 필드 ${f}가 있어야 한다`);
    }
    assert.equal(stop.hook_event_name, 'Stop');
    assert.equal(typeof stop.stop_hook_active, 'boolean');
    assert.equal(typeof stop.last_assistant_message, 'string');
    assert.ok(Array.isArray(stop.background_tasks));
    assert.ok(Array.isArray(stop.session_crons));
    assert.equal(typeof stop.permission_mode, 'string');
    assert.equal(typeof stop.effort.level, 'string');
  });

  test('`reason` 필드는 존재하지 않는다 (dead 선언 재발 방지)', () => {
    const [stop] = loadFixture('stop.jsonl');

    assert.equal('reason' in stop, false, 'Stop 입력에 reason은 없다');
    assert.equal(stop.reason, undefined);
  });

  test('last_assistant_message는 수 KB급이 될 수 있다 (실측 921자)', () => {
    const [stop] = loadFixture('stop.jsonl');

    assert.equal(stop.last_assistant_message.length, 921);
    // readStdin이 절단하면 이 데이터를 온전히 받을 수 없다 → stdin.test.mjs 참조
  });

  test('background_tasks 항목 구조', () => {
    const [stop] = loadFixture('stop.jsonl');
    const [task] = stop.background_tasks;

    assert.equal(typeof task.id, 'string');
    assert.equal(typeof task.type, 'string');
    assert.equal(typeof task.status, 'string');
    assert.equal(typeof task.description, 'string');
  });
});

describe('Notification 페이로드 (notification.jsonl)', () => {
  test('공통 필드 + message/notification_type이 존재한다', () => {
    const records = loadFixture('notification.jsonl');
    assert.ok(records.length > 0);

    for (const rec of records) {
      for (const f of HOOK_BASE_FIELDS) {
        assert.ok(f in rec, `공통 필드 ${f}가 있어야 한다`);
      }
      assert.equal(rec.hook_event_name, 'Notification');
      assert.equal(typeof rec.message, 'string');
      assert.equal(typeof rec.notification_type, 'string');
    }
  });

  test('Notification에는 permission_mode/effort가 오지 않는다', () => {
    const records = loadFixture('notification.jsonl');

    for (const rec of records) {
      assert.equal('permission_mode' in rec, false);
      assert.equal('effort' in rec, false);
    }
  });

  test('실측된 notification_type 종류', () => {
    const types = loadFixture('notification.jsonl').map((r) => r.notification_type);

    assert.deepEqual(types.sort(), ['idle_prompt', 'permission_prompt']);
  });
});

describe('픽스처 익명화', () => {
  test('실제 사용자 경로가 남아 있지 않다 (공개 저장소)', () => {
    for (const name of [
      'post-tool-use-bash.jsonl',
      'post-tool-use-failure-bash.jsonl',
      'stop.jsonl',
      'notification.jsonl',
    ]) {
      const raw = readFileSync(join(__dirname, 'fixtures', name), 'utf8');
      assert.equal(/zerolive/.test(raw), false, `${name}에 실제 사용자명이 남아 있다`);
    }
  });
});

describe('stop-ralph 회귀 (실측 Stop 페이로드 사용)', () => {
  let dir;

  function setupRalphState(state) {
    dir = mkdtempSync(join(tmpdir(), 'ralph-test-'));
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', '.ralph_state'), JSON.stringify(state));
    return dir;
  }

  test('활성 + 미완료면 block JSON을 출력한다', async () => {
    const root = setupRalphState({ active: true, status: 'working' });
    const [stop] = loadFixture('stop.jsonl');

    const out = await captureStdout(() =>
      handleStopRalph({ projectRoot: root, stdinData: JSON.stringify(stop) })
    );

    assert.equal(JSON.parse(out).decision, 'block');
    rmSync(root, { recursive: true, force: true });
  });

  test('stop_hook_active=true면 무한 루프 방지를 위해 차단하지 않는다', async () => {
    const root = setupRalphState({ active: true, status: 'working' });
    const [stop] = loadFixture('stop.jsonl');
    const payload = { ...stop, stop_hook_active: true };

    const out = await captureStdout(() =>
      handleStopRalph({ projectRoot: root, stdinData: JSON.stringify(payload) })
    );

    assert.equal(out, '');
    rmSync(root, { recursive: true, force: true });
  });

  test('completed 상태면 차단하지 않는다', async () => {
    const root = setupRalphState({ active: true, status: 'completed' });
    const [stop] = loadFixture('stop.jsonl');

    const out = await captureStdout(() =>
      handleStopRalph({ projectRoot: root, stdinData: JSON.stringify(stop) })
    );

    assert.equal(out, '');
    rmSync(root, { recursive: true, force: true });
  });

  test('.ralph_state가 없으면 아무것도 하지 않는다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ralph-none-'));
    const [stop] = loadFixture('stop.jsonl');

    const out = await captureStdout(() =>
      handleStopRalph({ projectRoot: root, stdinData: JSON.stringify(stop) })
    );

    assert.equal(out, '');
    rmSync(root, { recursive: true, force: true });
  });
});
