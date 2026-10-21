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
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateRalphBlock } from '../src/hooks/events/stop-ralph.ts';

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

  // 판정은 "멈추려는 주체가 ralph일 때"만 한다. ralph는 서브에이전트라 실제로는
  // SubagentStop 페이로드(agent_type: "ralph")로 들어온다. 실측 Stop 픽스처에
  // 공식 문서의 SubagentStop 필드를 얹어 ralph 페이로드를 만든다.
  function ralphStop(stop) {
    return {
      ...stop,
      hook_event_name: 'SubagentStop',
      agent_id: 'def456',
      agent_type: 'ralph',
      agent_transcript_path: '/tmp/agent-def456.jsonl',
    };
  }

  function setupRalphState(state) {
    dir = mkdtempSync(join(tmpdir(), 'ralph-test-'));
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', '.ralph_state'), JSON.stringify(state));
    return dir;
  }

  // evaluateRalphBlock은 순수 함수다 — block 여부를 반환만 하고, stdout 출력은
  // 통합 핸들러(stop.ts)가 담당한다. 여기서는 반환 계약을 검증한다.
  test('활성 + 미완료면 block 응답을 반환한다', () => {
    const root = setupRalphState({ active: true, status: 'working' });
    const stop = ralphStop(loadFixture('stop.jsonl')[0]);

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(stop) });

    assert.equal(result?.decision, 'block');
    rmSync(root, { recursive: true, force: true });
  });

  test('stop_hook_active=true면 무한 루프 방지를 위해 null을 반환한다', () => {
    const root = setupRalphState({ active: true, status: 'working' });
    const stop = ralphStop(loadFixture('stop.jsonl')[0]);
    const payload = { ...stop, stop_hook_active: true };

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(payload) });

    assert.equal(result, null);
    rmSync(root, { recursive: true, force: true });
  });

  test('completed 상태면 null을 반환한다', () => {
    const root = setupRalphState({ active: true, status: 'completed' });
    const stop = ralphStop(loadFixture('stop.jsonl')[0]);

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(stop) });

    assert.equal(result, null);
    rmSync(root, { recursive: true, force: true });
  });

  test('.ralph_state가 없으면 null을 반환한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'ralph-none-'));
    const stop = ralphStop(loadFixture('stop.jsonl')[0]);

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(stop) });

    assert.equal(result, null);
    rmSync(root, { recursive: true, force: true });
  });

  test('stale 상태(30분+ 미갱신)는 활성이어도 차단하지 않는다', () => {
    // 크래시/세션 재시작으로 남은 좀비 상태 재현: active:true 인데 파일이 오래됨.
    const root = setupRalphState({ active: true, status: 'working' });
    const statePath = join(root, '.claude', '.ralph_state');
    const old = new Date(Date.now() - 31 * 60 * 1000);
    utimesSync(statePath, old, old);
    const stop = ralphStop(loadFixture('stop.jsonl')[0]);

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(stop) });

    assert.equal(result, null, 'stale 좀비 상태는 Stop을 막지 않아야 한다');
    rmSync(root, { recursive: true, force: true });
  });

  test('갓 갱신된 활성 상태는 정상 차단한다(회귀)', () => {
    // stale 로직이 살아있는 ralph 루프까지 죽이지 않는지 확인.
    const root = setupRalphState({ active: true, status: 'working' });
    const stop = ralphStop(loadFixture('stop.jsonl')[0]);

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(stop) });

    assert.equal(result?.decision, 'block');
    rmSync(root, { recursive: true, force: true });
  });
});

describe('stop-ralph 판정 대상 한정 (agent_type)', () => {
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'ralph-scope-'));
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', '.ralph_state'),
      JSON.stringify({ active: true, status: 'working' })
    );
    return root;
  }

  test('메인 세션 Stop(agent_type 없음)은 ralph가 백그라운드에서 돌아도 막지 않는다', () => {
    // 회귀: 백그라운드 ralph 서브에이전트가 .ralph_state를 active로 두는 동안
    // 메인 세션의 모든 턴 종료가 'prompt' block으로 막혔다.
    const root = setup();
    const [stop] = loadFixture('stop.jsonl');
    assert.equal(stop.agent_type, undefined, '실측 메인 Stop 페이로드에는 agent_type이 없다');

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(stop) });

    assert.equal(result, null);
    rmSync(root, { recursive: true, force: true });
  });

  test('ralph가 아닌 서브에이전트의 SubagentStop은 막지 않는다', () => {
    const root = setup();
    const [stop] = loadFixture('stop.jsonl');
    const payload = { ...stop, hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'reviewer' };

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(payload) });

    assert.equal(result, null);
    rmSync(root, { recursive: true, force: true });
  });

  test('claude --agent ralph로 실행된 메인 세션 Stop은 막는다', () => {
    // 공식 문서: agent_type은 --agent 사용 시 메인 세션 훅에도 실린다.
    const root = setup();
    const [stop] = loadFixture('stop.jsonl');
    const payload = { ...stop, agent_type: 'ralph' };

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(payload) });

    assert.equal(result?.decision, 'block');
    rmSync(root, { recursive: true, force: true });
  });

  test("block reason은 자리표시자('prompt')가 아니라 실제 지시문이다", () => {
    // Stop/SubagentStop의 reason은 모델에 "계속해야 하는 이유"로 그대로 전달된다.
    const root = setup();
    const [stop] = loadFixture('stop.jsonl');
    const payload = { ...stop, agent_type: 'ralph' };

    const result = evaluateRalphBlock({ projectRoot: root, stdinData: JSON.stringify(payload) });

    assert.notEqual(result?.reason, 'prompt');
    assert.match(result?.reason ?? '', /\.ralph_state/);
    assert.match(result?.reason ?? '', /completed/);
    rmSync(root, { recursive: true, force: true });
  });
});
