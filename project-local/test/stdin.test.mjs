/**
 * readStdin — 절단 레이스 회귀 테스트
 *
 * 배경: 기존 구현은 'end' 이벤트와 50ms 하드 타임아웃을 경합시켰다.
 *   setTimeout(() => done(data.trim()), 50)
 * 느리거나 큰 페이로드는 50ms 시점까지 도착한 만큼만 읽히고 조용히 절단됐다.
 * Stop 페이로드의 last_assistant_message는 실측 921자이며 수 KB까지 커질 수 있다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { readStdin } from '../src/hooks/stdin.ts';

const CHUNK_SIZE = 4096;
const CHUNK_COUNT = 16; // 4096 * 16 = 65536 (64KB)
const CHUNK_DELAY_MS = 10; // 총 ~160ms → 구현이 50ms에서 끊기면 반드시 절단된다

/** 64KB를 여러 청크로 나눠 지연 주입하는 스트림을 만든다. */
function makeSlowChunkedStream() {
  const payload = 'x'.repeat(CHUNK_SIZE * CHUNK_COUNT);
  return {
    payload,
    stream: Readable.from(
      (async function* () {
        for (let i = 0; i < CHUNK_COUNT; i++) {
          await delay(CHUNK_DELAY_MS);
          yield payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        }
      })()
    ),
  };
}

/**
 * 수정 전 구현(50ms 하드 타임아웃 경합)의 재현.
 * 이 테스트가 실제로 절단을 잡아내는 테스트인지 검증하는 용도다.
 */
function legacyReadStdin(stream) {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      data += chunk;
    });
    stream.on('end', () => done(data.trim()));
    setTimeout(() => done(data.trim()), 50);
  });
}

describe('대용량/지연 페이로드', () => {
  test('64KB를 여러 청크로 지연 주입해도 전체를 수신한다', async () => {
    const { payload, stream } = makeSlowChunkedStream();

    const result = await readStdin(stream);

    assert.equal(result.length, 65536, '64KB 전체가 수신되어야 한다');
    assert.equal(result, payload);
  });

  test('(대조군) 수정 전 50ms 타임아웃 구현은 같은 입력을 절단한다', async () => {
    const { payload, stream } = makeSlowChunkedStream();

    const truncated = await legacyReadStdin(stream);

    assert.ok(
      truncated.length < payload.length,
      `구 구현은 절단되어야 한다 (실제: ${truncated.length}/${payload.length})`
    );
  });

  test('실측 Stop 페이로드 크기(수 KB JSON)를 온전히 읽어 파싱할 수 있다', async () => {
    // last_assistant_message 실측 921자 → 더 큰 경우도 안전해야 한다.
    const obj = { last_assistant_message: '가'.repeat(5000), stop_hook_active: false };
    const json = JSON.stringify(obj);
    const stream = Readable.from(
      (async function* () {
        for (let i = 0; i < json.length; i += 512) {
          await delay(5);
          yield json.slice(i, i + 512);
        }
      })()
    );

    const result = await readStdin(stream);

    assert.doesNotThrow(() => JSON.parse(result), 'JSON이 절단되지 않아야 한다');
    assert.equal(JSON.parse(result).last_assistant_message.length, 5000);
  });
});

describe('stdin 미연결 — 행 걸림 방지', () => {
  test('TTY면 즉시 빈 문자열을 반환한다 (대기하지 않음)', async () => {
    // isTTY인 스트림은 EOF가 오지 않는다. 기다리면 무한 대기가 된다.
    const ttyStream = Object.assign(new Readable({ read() {} }), { isTTY: true });

    const started = Date.now();
    const result = await readStdin(ttyStream);
    const elapsed = Date.now() - started;

    assert.equal(result, '');
    assert.ok(elapsed < 100, `즉시 반환해야 한다 (실제 ${elapsed}ms)`);
  });

  test('즉시 닫히는 stdin은 빈 문자열을 반환한다', async () => {
    const empty = Readable.from([]);

    const result = await readStdin(empty);

    assert.equal(result, '');
  });

  test('스트림 오류가 나도 throw하지 않고 수신분으로 진행한다', async () => {
    const stream = Readable.from(
      (async function* () {
        yield 'partial';
        throw new Error('stdin 폭발');
      })()
    );

    const result = await readStdin(stream);

    assert.equal(result, 'partial', '오류 전까지 받은 데이터로 진행한다');
  });
});

describe('안전장치 타임아웃 (무한 대기 방지)', () => {
  test('EOF가 끝내 오지 않아도 무한 대기하지 않는다', async () => {
    // TTY도 아니고 EOF도 오지 않는 스트림 (실제 훅 환경에서는 발생하지 않지만,
    // 발생 시 Claude가 멈추므로 상한을 둔다).
    const neverEnds = new Readable({ read() {} });
    neverEnds.push('partial payload');

    const started = Date.now();
    const result = await readStdin(neverEnds, 80); // 테스트용 짧은 상한
    const elapsed = Date.now() - started;

    assert.equal(result, 'partial payload', '수신분은 반환한다');
    assert.ok(elapsed < 1000, `상한 내 반환해야 한다 (실제 ${elapsed}ms)`);
    // 핸들이 열려 있으면 핸들러가 끝나도 프로세스가 종료되지 않는다(= Claude가 계속 막힘).
    assert.equal(neverEnds.destroyed, true, '포기한 stdin 핸들은 해제해야 한다');
  });

  test('정상 종료한 stdin은 destroy하지 않는다 (불필요한 개입 없음)', async () => {
    const stream = Readable.from(['{"a":1}']);

    await readStdin(stream);

    // 정상 경로에서는 이미 end된 스트림에 손대지 않는다.
    assert.equal(stream.readableEnded, true);
  });

  test('안전장치는 정상 페이로드와 경합하지 않는다 (구 50ms와의 차이)', async () => {
    // 64KB/160ms 입력도 기본 상한(10초) 안에서 온전히 수신된다.
    const { payload, stream } = makeSlowChunkedStream();

    const result = await readStdin(stream); // 기본 상한 사용

    assert.equal(result.length, payload.length, '정상 페이로드는 절단되지 않는다');
  });
});

describe('기존 동작 보존', () => {
  test('결과는 trim된다 (기존 구현과 동일)', async () => {
    const stream = Readable.from(['  {"a":1}  \n']);

    const result = await readStdin(stream);

    assert.equal(result, '{"a":1}');
  });

  test('한 번에 들어오는 작은 페이로드도 정상 처리한다', async () => {
    const stream = Readable.from(['{"hook_event_name":"Stop"}']);

    const result = await readStdin(stream);

    assert.equal(JSON.parse(result).hook_event_name, 'Stop');
  });
});
