/**
 * 설정 파일 읽기/쓰기 테스트
 *
 * 배경: 구 write_config()는 node -e 에 넘길 **JS 소스 문자열**에 토큰을 보간했다.
 *   node -e "const config = { bot_token: '${token}', ... }"
 * 토큰에 작은따옴표 하나만 있어도 문법이 깨지고, `'; rm -rf /; //` 같은 값은
 * 그대로 실행된다. 값을 코드가 아니라 데이터로 다루는지 여기서 못박는다.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readConfig, writeConfig, configPath } from '../src/messenger/config.ts';

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'messenger-config-'));
  file = join(dir, '.claude', 'messenger.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const BASE = {
  bot_token: '1234567890:TEST_TOKEN_NOT_REAL',
  chat_id: '999999999',
  enabled: true,
  min_duration: 300,
  scope: 'global',
};

describe('writeConfig — 인젝션 방어', () => {
  /** 구 구현의 문자열 보간을 깨뜨리는 값들. */
  const HOSTILE = [
    ["셸 인젝션 시도", "'; rm -rf /; //"],
    ['작은따옴표', "it's a token"],
    ['큰따옴표', 'say "hi"'],
    ['개행', 'line1\nline2'],
    ['백슬래시', 'back\\slash'],
    ['템플릿 리터럴', '${process.exit(1)}'],
    ['JS 주석 + 코드', "x'); require('fs').writeFileSync('/tmp/pwned','1'); //"],
    ['중괄호/콜론', '{"a":"b"}'],
    ['유니코드/이모지', '토큰 ✅ 값'],
    ['캐리지리턴', 'a\r\nb'],
  ];

  for (const [label, hostile] of HOSTILE) {
    test(`bot_token에 ${label} 이 들어가도 리터럴로 보존된다`, () => {
      writeConfig({ ...BASE, bot_token: hostile }, file);

      // 1) 유효한 JSON이어야 한다
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw); // 던지면 실패

      // 2) 값이 한 글자도 변하지 않아야 한다
      assert.equal(parsed.bot_token, hostile);

      // 3) 읽기 경로로 왕복해도 동일
      assert.equal(readConfig(file).bot_token, hostile);
    });
  }

  test('적대적 값이 chat_id/scope에 들어가도 리터럴 보존', () => {
    const hostile = "'; rm -rf /; //";
    writeConfig({ ...BASE, chat_id: hostile, scope: hostile }, file);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(parsed.chat_id, hostile);
    assert.equal(parsed.scope, hostile);
  });

  test('인젝션 시도가 부수 효과를 남기지 않는다', () => {
    // 구 구현이라면 node -e 안에서 실행됐을 코드.
    const canary = join(dir, 'pwned');
    writeConfig(
      { ...BASE, bot_token: `x'); require('fs').writeFileSync('${canary}','1'); //` },
      file
    );
    assert.throws(() => statSync(canary), '인젝션 페이로드가 실행되면 안 된다');
  });
});

describe('writeConfig — 파일 권한', () => {
  test('새로 만든 파일은 0600', () => {
    writeConfig(BASE, file);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  test('기존 파일이 느슨한 권한이어도 0600으로 되돌린다', () => {
    // writeFileSync의 mode 옵션은 신규 생성에만 적용된다.
    // 덮어쓰기만 하면 0644가 유지돼 토큰이 노출된다 → 명시적 chmod가 필요한 이유.
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{}');
    chmodSync(file, 0o644);
    assert.equal(statSync(file).mode & 0o777, 0o644);

    writeConfig(BASE, file);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  test('디렉토리가 없으면 생성한다', () => {
    const deep = join(dir, 'a', 'b', '.claude', 'messenger.json');
    writeConfig(BASE, deep);
    assert.equal(JSON.parse(readFileSync(deep, 'utf8')).chat_id, BASE.chat_id);
  });
});

describe('writeConfig — 파일 형식 (bash 호환)', () => {
  test('키 순서·타입·들여쓰기·끝 개행이 bash 산출물과 같다', () => {
    // bash write_config가 만들던 형태: 2칸 들여쓰기 + 끝 개행,
    // bot_token/chat_id/scope는 문자열, enabled는 boolean, min_duration은 number.
    writeConfig(BASE, file);
    const raw = readFileSync(file, 'utf8');
    assert.equal(
      raw,
      `{
  "bot_token": "1234567890:TEST_TOKEN_NOT_REAL",
  "chat_id": "999999999",
  "enabled": true,
  "min_duration": 300,
  "scope": "global"
}
`
    );
  });
});

describe('readConfig — 하위 호환', () => {
  const write = (obj) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  };

  test('기존 messenger.json을 수정 없이 읽는다', () => {
    write(BASE);
    const before = readFileSync(file);
    const cfg = readConfig(file);
    assert.deepEqual(cfg, BASE);
    assert.deepEqual(readFileSync(file), before, '읽기가 파일을 건드리면 안 된다');
  });

  test('파일이 없으면 null', () => {
    assert.equal(readConfig(file), null);
  });

  test('chat_id가 숫자로 저장돼 있어도 문자열로 읽는다', () => {
    // bash: String(c.chat_id||'')
    write({ ...BASE, chat_id: 999999999 });
    assert.equal(readConfig(file).chat_id, '999999999');
  });

  test('enabled는 false일 때만 false (bash: c.enabled===false)', () => {
    write({ ...BASE, enabled: false });
    assert.equal(readConfig(file).enabled, false);
    write({ ...BASE, enabled: true });
    assert.equal(readConfig(file).enabled, true);
  });

  test('enabled 누락 시 true로 본다', () => {
    const { enabled, ...rest } = BASE;
    write(rest);
    assert.equal(readConfig(file).enabled, true);
  });

  test('누락 필드는 bash와 같은 기본값', () => {
    write({});
    const cfg = readConfig(file);
    assert.deepEqual(cfg, {
      bot_token: '',
      chat_id: '',
      enabled: true,
      min_duration: 0,
      scope: 'global',
    });
  });

  test('JSON이 깨져도 실패가 아니라 기본값으로 진행한다 (bash 동등)', () => {
    // bash read_config는 각 node -e를 `|| true`로 감싸 파일만 있으면 성공을 반환했다.
    // status가 '설정 파일 없음' 대신 빈 값을 보여주던 동작을 유지한다.
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ not valid json');
    const cfg = readConfig(file);
    assert.notEqual(cfg, null);
    assert.equal(cfg.bot_token, '');
    assert.equal(cfg.enabled, true);
  });
});

describe('configPath', () => {
  test('HOME 하위 .claude/messenger.json', () => {
    assert.equal(configPath('/tmp/x'), '/tmp/x/.claude/messenger.json');
  });
});
