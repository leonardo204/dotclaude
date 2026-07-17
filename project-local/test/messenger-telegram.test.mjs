/**
 * Telegram 전송 테스트 (fetch 주입 — 실제 네트워크 없음)
 *
 * 배경: 구 구현은 Stop 훅에서 `send_telegram ... >/dev/null 2>&1 || true` 로 호출돼
 * 전송 실패가 어디에도 남지 않았다. HTML 파싱 400으로 알림이 통째 사라져도
 * 흔적이 없었다. 실패는 반드시 기록하되, **토큰은 절대 기록하지 않는다** —
 * 로그는 messenger.json(0600)과 달리 컨텍스트 주입 경로를 탄다.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendMessage, logLine } from '../src/messenger/telegram.ts';

const TOKEN = '7891234567:AAH1x-yZ_abcdefghijklmnopqrstuvwx';
const CHAT = '999999999';

let dir;
let logFile;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'messenger-telegram-'));
  logFile = join(dir, 'messenger.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 지정한 응답을 돌려주는 가짜 fetch. 호출 인자를 기록한다. */
function fakeFetch(body, { status = 200, throws = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw throws;
    return { status, text: async () => body };
  };
  impl.calls = calls;
  return impl;
}

const readLog = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');

describe('sendMessage — 요청 형태', () => {
  test('parse_mode=HTML로 보낸다', async () => {
    const f = fakeFetch('{"ok":true,"result":{}}');
    await sendMessage(TOKEN, CHAT, 'hi', { fetchImpl: f, logFile });

    const { url, init } = f.calls[0];
    assert.equal(url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('parse_mode'), 'HTML');
    assert.equal(body.get('chat_id'), CHAT);
    assert.equal(body.get('text'), 'hi');
  });

  test('본문을 자동 이스케이프하지 않는다 (호출부 책임)', async () => {
    // 자동 이스케이프하면 호출부가 <b> 서식을 넣을 수 없다.
    // sendMessage는 '이미 조립이 끝난 HTML'을 받는다.
    const f = fakeFetch('{"ok":true}');
    await sendMessage(TOKEN, CHAT, '<b>제목</b>', { fetchImpl: f, logFile });
    assert.equal(new URLSearchParams(f.calls[0].init.body).get('text'), '<b>제목</b>');
  });
});

describe('sendMessage — ok 필드 검증', () => {
  test('ok:true 면 성공', async () => {
    const res = await sendMessage(TOKEN, CHAT, 'hi', {
      fetchImpl: fakeFetch('{"ok":true,"result":{"message_id":1}}'),
      logFile,
    });
    assert.equal(res.ok, true);
  });

  test('HTTP 200이어도 ok:false 면 실패로 본다', async () => {
    const res = await sendMessage(TOKEN, CHAT, 'hi', {
      fetchImpl: fakeFetch('{"ok":false,"description":"Bad Request"}', { status: 200 }),
      logFile,
    });
    assert.equal(res.ok, false);
  });

  test('실제 400 응답의 description을 그대로 전달한다', async () => {
    // 구 bash 구현에서 실측된 응답.
    const body =
      '{"ok":false,"error_code":400,"description":"Bad Request: can\'t parse entities: Unsupported start tag \\"bar\\" at byte offset 33"}';
    const res = await sendMessage(TOKEN, CHAT, 'x', {
      fetchImpl: fakeFetch(body, { status: 400 }),
      logFile,
    });
    assert.equal(res.ok, false);
    assert.match(res.description, /Unsupported start tag/);
  });

  test('description이 없으면 bash와 같은 문구', async () => {
    const res = await sendMessage(TOKEN, CHAT, 'x', {
      fetchImpl: fakeFetch('{"ok":false}'),
      logFile,
    });
    assert.equal(res.description, '알 수 없는 오류');
  });

  test('응답이 JSON이 아니면 bash와 같은 문구', async () => {
    const res = await sendMessage(TOKEN, CHAT, 'x', {
      fetchImpl: fakeFetch('<html>502 Bad Gateway</html>', { status: 502 }),
      logFile,
    });
    assert.equal(res.ok, false);
    assert.equal(res.description, '파싱 실패');
  });

  test('네트워크 오류도 예외를 던지지 않는다', async () => {
    // 훅 경로에서 호출되므로 던지면 Claude가 멈춘다.
    const res = await sendMessage(TOKEN, CHAT, 'x', {
      fetchImpl: fakeFetch('', { throws: new Error('ECONNREFUSED') }),
      logFile,
    });
    assert.equal(res.ok, false);
    assert.equal(res.description, '파싱 실패');
  });
});

describe('sendMessage — 실패 로깅 (토큰 유출 금지)', () => {
  test('실패는 흔적을 남긴다', async () => {
    await sendMessage(TOKEN, CHAT, 'x', {
      fetchImpl: fakeFetch('{"ok":false,"description":"Bad Request: chat not found"}', { status: 400 }),
      logFile,
    });
    const log = readLog();
    assert.match(log, /send failed/);
    assert.match(log, /chat not found/);
  });

  test('로그에 봇 토큰이 없다 — URL 경유', async () => {
    // 요청 URL은 .../bot<TOKEN>/sendMessage 라 토큰이 그대로 들어간다.
    await sendMessage(TOKEN, CHAT, 'x', {
      fetchImpl: fakeFetch('{"ok":false,"description":"Bad Request"}', { status: 400 }),
      logFile,
    });
    const log = readLog();
    assert.ok(log.length > 0, '로그가 남아야 한다');
    assert.ok(!log.includes(TOKEN), '토큰 전체가 로그에 있으면 안 된다');
    assert.ok(!log.includes('AAH1x-yZ_abcdefghijklmnopqrstuvwx'), '토큰 시크릿부가 있으면 안 된다');
    assert.match(log, /bot<REDACTED>/);
  });

  test('로그에 봇 토큰이 없다 — 응답 본문에 토큰이 섞인 경우', async () => {
    // Telegram이 에러 본문에 요청 URL을 되돌려주는 경우를 가정.
    const body = `{"ok":false,"description":"Unauthorized for bot${TOKEN}"}`;
    await sendMessage(TOKEN, CHAT, 'x', {
      fetchImpl: fakeFetch(body, { status: 401 }),
      logFile,
    });
    const log = readLog();
    assert.ok(!log.includes('AAH1x-yZ_abcdefghijklmnopqrstuvwx'));
    assert.match(log, /bot<REDACTED>/);
  });

  test('네트워크 오류 로그에도 토큰이 없다', async () => {
    await sendMessage(TOKEN, CHAT, 'x', {
      fetchImpl: fakeFetch('', { throws: new Error(`connect failed to bot${TOKEN}`) }),
      logFile,
    });
    const log = readLog();
    assert.ok(!log.includes('AAH1x-yZ_abcdefghijklmnopqrstuvwx'));
  });

  test('성공하면 로그를 남기지 않는다', async () => {
    await sendMessage(TOKEN, CHAT, 'x', { fetchImpl: fakeFetch('{"ok":true}'), logFile });
    assert.equal(readLog(), '', '성공 경로가 로그를 채우면 회전만 유발한다');
  });
});

describe('logLine', () => {
  test('타임스탬프와 함께 append 한다', () => {
    logLine('first', logFile);
    logLine('second', logFile);
    const lines = readLog().trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z first$/);
    assert.match(lines[1], / second$/);
  });

  test('기록 전 redact를 통과시킨다', () => {
    logLine(`oops bot${TOKEN}`, logFile);
    assert.ok(!readLog().includes('AAH1x-yZ_abcdefghijklmnopqrstuvwx'));
  });

  test('쓸 수 없는 경로여도 던지지 않는다', () => {
    // 로깅 실패가 알림 경로를 죽이면 안 된다.
    assert.doesNotThrow(() => logLine('x', '/proc/nonexistent/messenger.log'));
  });
});
