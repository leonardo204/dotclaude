/**
 * Stop(세션 통계) 훅 — end_time 타임존 회귀 테스트
 *
 * 배경: end_time을 new Date().toISOString()(UTC)로 저장했으나 start_time은
 * db.ts의 datetime('now','localtime')(로컬)이었다. 실측 결과 세션 60이
 * start 09:44 → end 05:57로, 종료가 시작보다 앞서는 상태였다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleStopSession, localTimestamp } from '../src/hooks/events/stop-session.ts';
import { createFakeDB, captureStdout } from './helpers/fake-db.mjs';

const TS_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** SQLite datetime('now','localtime') 형식 문자열을 로컬 Date로 파싱한다. */
function parseLocal(ts) {
  const [d, t] = ts.split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m, s] = t.split(':').map(Number);
  return new Date(Y, M - 1, D, h, m, s);
}

describe('localTimestamp', () => {
  test("SQLite datetime('now','localtime')과 같은 형식을 만든다", () => {
    // 로컬 구성요소로 만든 Date → 타임존과 무관하게 결과가 고정된다.
    const d = new Date(2026, 2, 27, 9, 44, 5);

    assert.equal(localTimestamp(d), '2026-03-27 09:44:05');
    assert.match(localTimestamp(d), TS_FORMAT);
  });

  test('한 자리 수 월/일/시/분/초를 0으로 채운다', () => {
    assert.equal(localTimestamp(new Date(2026, 0, 3, 4, 5, 6)), '2026-01-03 04:05:06');
  });

  test('UTC가 아니라 로컬 시각을 쓴다', () => {
    const d = new Date(2026, 2, 27, 9, 44, 5);
    const utc = d.toISOString().replace('T', ' ').slice(0, 19);

    if (d.getTimezoneOffset() !== 0) {
      // 수정 전 구현은 이 UTC 문자열을 저장했다.
      assert.notEqual(localTimestamp(d), utc, '로컬 타임존에서는 UTC와 달라야 한다');
    }
    assert.equal(localTimestamp(d), '2026-03-27 09:44:05');
  });
});

describe('end_time 저장 (버그 수정 증명)', () => {
  test('end_time이 start_time보다 앞서지 않는다', async () => {
    // start_time을 1분 전 로컬 시각으로 둔다 (db.ts가 기록하는 형식과 동일).
    const startTime = localTimestamp(new Date(Date.now() - 60_000));
    const db = createFakeDB({
      sessionId: 60,
      editCount: 3,
      sessionInfo: { id: 60, start_time: startTime },
    });

    await captureStdout(() => handleStopSession({ db }));

    assert.equal(db.calls.sessionUpdate.length, 1);
    const { end_time } = db.calls.sessionUpdate[0].data;
    assert.match(end_time, TS_FORMAT, 'SQLite localtime 형식이어야 한다');

    // 수정 전(UTC 저장)에는 KST 기준으로 9시간 과거가 되어 이 단언이 깨졌다.
    assert.ok(
      parseLocal(end_time).getTime() >= parseLocal(startTime).getTime(),
      `종료(${end_time})가 시작(${startTime})보다 앞서면 안 된다`
    );
  });

  test('end_time은 현재 로컬 시각과 일치한다', async () => {
    const db = createFakeDB({ sessionId: 1, sessionInfo: { id: 1, start_time: localTimestamp() } });

    await captureStdout(() => handleStopSession({ db }));

    const { end_time } = db.calls.sessionUpdate[0].data;
    const diffMs = Math.abs(parseLocal(end_time).getTime() - Date.now());
    assert.ok(diffMs < 5000, `현재 로컬 시각과 5초 이내여야 한다 (차이 ${diffMs}ms)`);
  });

  test('files_changed와 duration_minutes를 함께 저장한다', async () => {
    const db = createFakeDB({
      sessionId: 12,
      editCount: 5,
      sessionInfo: { id: 12, start_time: localTimestamp(new Date(Date.now() - 120_000)) },
    });

    await captureStdout(() => handleStopSession({ db }));

    const { data } = db.calls.sessionUpdate[0];
    assert.equal(data.files_changed, 5);
    assert.equal(data.duration_minutes, 2, '2분 전 시작 → duration 2분');
  });
});

describe('기존 동작 보존', () => {
  test('세션이 없으면 아무것도 하지 않는다', async () => {
    const db = createFakeDB({ sessionId: 0 });

    const out = await captureStdout(() => handleStopSession({ db }));

    assert.equal(db.calls.sessionUpdate.length, 0);
    assert.equal(out, '');
  });

  test('편집 파일이 있으면 session_summary를 저장한다', async () => {
    const db = createFakeDB({
      sessionId: 3,
      editCount: 2,
      sessionInfo: { id: 3, start_time: localTimestamp() },
      recentFiles: ['src/a.ts', 'src/b.ts'],
    });

    await captureStdout(() => handleStopSession({ db }));

    const summary = db.calls.liveSet.find((c) => c.key === 'session_summary');
    assert.ok(summary, 'session_summary가 저장되어야 한다');
    assert.equal(summary.value, '2 files: src/a.ts, src/b.ts');
  });

  test('핸드오프 블록을 저장한다', async () => {
    const db = createFakeDB({
      sessionId: 3,
      editCount: 2,
      sessionInfo: { id: 3, start_time: localTimestamp() },
      recentFiles: ['src/a.ts'],
    });

    await captureStdout(() => handleStopSession({ db }));

    const handoff = db.calls.liveSet.find((c) => c.key === 'session_handoff');
    assert.ok(handoff, 'session_handoff가 저장되어야 한다');
    assert.match(handoff.value, /직전 세션 #3/);
  });

  test('디버그 1줄을 stdout에 출력한다', async () => {
    const db = createFakeDB({ sessionId: 9, sessionInfo: { id: 9, start_time: localTimestamp() } });

    const out = await captureStdout(() => handleStopSession({ db }));

    assert.match(out, /\[hook:on-stop\] DB 조회: 세션 #9/);
  });
});
