/**
 * 포맷/이스케이프 테스트
 *
 * 배경: 구 send_telegram()은 parse_mode=HTML로 보내면서 본문을 이스케이프하지 않았다.
 * current_task에 '<' 나 '&' 가 섞인 순간 Telegram이 400으로 거절했고,
 * 호출부가 `2>/dev/null || true` 라 알림이 통째로, 무흔적으로 사라졌다.
 * 실측 응답:
 *   {"ok":false,"error_code":400,"description":"Bad Request: can't parse entities:
 *    Unsupported start tag \"bar\" at byte offset 33"}
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, bold, redact, padByte, formatDuration } from '../src/messenger/format.ts';

describe('escapeHtml', () => {
  test('400을 유발하던 실제 형태의 본문을 안전하게 만든다', () => {
    const input = 'if (a < b && c > d) { x = "<script>" }';
    const actual = escapeHtml(input);
    assert.equal(actual, 'if (a &lt; b &amp;&amp; c &gt; d) { x = "&lt;script&gt;" }');
    // Telegram HTML 파서가 태그 시작으로 오인할 문자가 남아 있으면 안 된다.
    assert.ok(!/[<>]/.test(actual), '이스케이프 후 raw < > 가 남으면 400이 난다');
  });

  test('& < > 3자만 치환한다', () => {
    assert.equal(escapeHtml('&'), '&amp;');
    assert.equal(escapeHtml('<'), '&lt;');
    assert.equal(escapeHtml('>'), '&gt;');
  });

  test("따옴표는 건드리지 않는다 (HTML 모드에서 텍스트 노드에 안전)", () => {
    assert.equal(escapeHtml(`"'`), `"'`);
  });

  test('& 를 먼저 치환해 이중 이스케이프를 피한다', () => {
    // '<' → '&lt;' 를 만든 뒤 '&'를 치환하면 '&amp;lt;' 가 되어 사용자에게 리터럴이 보인다.
    assert.equal(escapeHtml('<'), '&lt;');
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });

  test('이미 이스케이프된 문자열을 두 번 통과시키면 이중 이스케이프된다 (호출 1회 보장이 전제)', () => {
    const once = escapeHtml('a < b');
    assert.equal(escapeHtml(once), 'a &amp;lt; b');
  });

  test('빈 문자열과 평문은 그대로', () => {
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml('작업 완료'), '작업 완료');
  });

  test('이모지/한글이 손상되지 않는다', () => {
    assert.equal(escapeHtml('[dotclaude] 테스트 성공! ✅'), '[dotclaude] 테스트 성공! ✅');
  });
});

describe('bold — 서식 조립 순서', () => {
  test('내용을 이스케이프한 뒤 태그를 붙인다', () => {
    const actual = bold('a < b');
    assert.equal(actual, '<b>a &lt; b</b>');
  });

  test('서식 태그 자체는 이스케이프되지 않는다', () => {
    const actual = bold('제목');
    assert.equal(actual, '<b>제목</b>');
    assert.ok(!actual.includes('&lt;b&gt;'), '태그가 escape되면 사용자에게 리터럴로 보인다');
  });

  test('순서가 뒤집힌 조립(escape 후행)은 태그를 망가뜨린다 — 회귀 잠금', () => {
    // 이 테스트는 "하면 안 되는 방식"을 명시적으로 박제한다.
    const wrong = escapeHtml(`<b>${'a < b'}</b>`);
    assert.equal(wrong, '&lt;b&gt;a &lt; b&lt;/b&gt;');
    assert.notEqual(wrong, bold('a < b'));
  });

  test('사용자 입력이 태그를 주입할 수 없다', () => {
    const actual = bold('</b><script>alert(1)</script>');
    assert.equal(actual, '<b>&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;</b>');
    // 열고 닫는 <b> 한 쌍 외에 raw 태그가 없어야 한다.
    assert.equal(actual.match(/<[^>]+>/g).join(''), '<b></b>');
  });
});

describe('redact — 로그/에러에서 봇 토큰 제거', () => {
  test('bot<숫자>:<토큰> 형태를 지운다', () => {
    const actual = redact('send failed: bot123456:AAxxx returned 400');
    assert.ok(!actual.includes('AAxxx'), '토큰이 로그에 남으면 안 된다');
    assert.equal(actual, 'send failed: bot<REDACTED> returned 400');
  });

  test('요청 URL에 박힌 토큰을 지운다', () => {
    const url = 'https://api.telegram.org/bot7891234567:AAH1x-yZ_abcdefghijklmnopqrstuvwx/sendMessage';
    const actual = redact(`send failed url=${url}`);
    assert.ok(!actual.includes('AAH1x-yZ_abcdefghijklmnopqrstuvwx'));
    assert.equal(actual, 'send failed url=https://api.telegram.org/bot<REDACTED>/sendMessage');
  });

  test("'bot' 접두사 없이 노출된 토큰도 지운다", () => {
    const actual = redact('config dump: 7891234567:AAH1x-yZ_abcdefghijklmnopqrstuvwx');
    assert.ok(!actual.includes('AAH1x-yZ_abcdefghijklmnopqrstuvwx'));
    assert.match(actual, /<REDACTED>/);
  });

  test('한 문자열에 여러 번 나와도 전부 지운다', () => {
    const actual = redact('bot111111:AAA and bot222222:BBB');
    assert.equal(actual, 'bot<REDACTED> and bot<REDACTED>');
  });

  test('토큰이 아닌 문자열은 보존한다', () => {
    const msg = 'Bad Request: chat not found (chat_id=999999999)';
    assert.equal(redact(msg), msg);
  });
});

describe('padByte — bash printf "%-14s" 재현', () => {
  test('한글 라벨은 바이트로 세므로 패딩이 붙지 않는다', () => {
    // "설정 파일:" 은 6자지만 UTF-8 14바이트. bash printf는 폭을 바이트로 센다.
    // String.padEnd(14)를 썼다면 공백 8개가 더 붙어 골든이 깨진다.
    assert.equal(Buffer.byteLength('설정 파일:', 'utf8'), 14);
    assert.equal(padByte('설정 파일:', 14), '설정 파일:');
  });

  test('ASCII 라벨은 폭까지 채운다', () => {
    assert.equal(padByte('bot_token:', 14), 'bot_token:    ');
    assert.equal(padByte('scope:', 14), 'scope:        ');
  });

  test('폭을 넘으면 자르지 않는다', () => {
    assert.equal(padByte('very_long_key_name:', 14), 'very_long_key_name:');
  });
});

describe('formatDuration — bash format_duration 동등', () => {
  const CASES = [
    [0, '1초 미만'],
    [-5, '1초 미만'],
    [1, '1초'],
    [59, '59초'],
    [60, '1분'],
    [90, '1분 30초'],
    [300, '5분'],
    [3599, '59분 59초'],
    [3600, '1시간'],
    [3660, '1시간 1분'],
    [7325, '2시간 2분'],
  ];

  for (const [sec, expected] of CASES) {
    test(`${sec}초 → ${expected}`, () => {
      assert.equal(formatDuration(sec), expected);
    });
  }
});
