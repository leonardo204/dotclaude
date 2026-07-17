/**
 * 훅 배선 계약 테스트 (settings.json ↔ bridge.ts)
 *
 * 이 하니스의 에러 로깅이 죽어 있던 이유 중 하나는 "잘못된 이벤트에 붙어 있던 것"이다.
 * 코드가 아무리 옳아도 배선이 틀리면 한 줄도 실행되지 않는다.
 * settings.json이 부르는 HOOK_EVENT와 bridge.ts가 처리하는 이벤트가
 * 어긋나면 여기서 잡는다 (등록했는데 dispatch 누락 / dispatch했는데 미등록).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS = JSON.parse(readFileSync(join(__dirname, '..', 'settings.json'), 'utf8'));
const BRIDGE_SRC = readFileSync(join(__dirname, '..', 'src', 'hooks', 'bridge.ts'), 'utf8');

/** settings.json의 모든 command에서 HOOK_EVENT=<name>을 수집한다. */
function registeredEvents() {
  const events = new Set();
  for (const entries of Object.values(SETTINGS.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        const m = hook.command.match(/HOOK_EVENT=([a-z-]+)/);
        if (m) events.add(m[1]);
      }
    }
  }
  return events;
}

/** bridge.ts가 실제로 분기하는 이벤트인지 (switch case 또는 조기 분기). */
function bridgeHandles(event) {
  return (
    BRIDGE_SRC.includes(`case '${event}':`) ||
    BRIDGE_SRC.includes(`hookEvent === '${event}'`)
  );
}

describe('settings.json ↔ bridge.ts 배선', () => {
  test('등록된 모든 HOOK_EVENT를 bridge가 처리한다', () => {
    for (const event of registeredEvents()) {
      assert.ok(bridgeHandles(event), `bridge.ts가 '${event}'를 처리하지 않는다`);
    }
  });

  test('PostToolUseFailure가 Bash matcher로 등록돼 있다', () => {
    const entries = SETTINGS.hooks.PostToolUseFailure;
    assert.ok(Array.isArray(entries) && entries.length > 0, 'PostToolUseFailure 훅이 없다');
    assert.equal(entries[0].matcher, 'Bash');
    assert.match(entries[0].hooks[0].command, /HOOK_EVENT=post-bash-fail\b/);
  });

  test('실패 이벤트가 성공 이벤트와 다른 핸들러로 간다', () => {
    // PostToolUse는 "After a tool call succeeds"다. 실패를 여기에 붙이면
    // 훅이 영영 발동하지 않는다 (실측 확인).
    assert.ok(bridgeHandles('post-bash'), 'post-bash 분기 유지');
    assert.ok(bridgeHandles('post-bash-fail'), 'post-bash-fail 분기 필요');
    assert.match(BRIDGE_SRC, /handlePostBashFailure\(/);
  });

  test('post-bash-fail은 PostToolUseFailure에만 등록된다', () => {
    const postToolUse = JSON.stringify(SETTINGS.hooks.PostToolUse);
    assert.equal(
      /post-bash-fail/.test(postToolUse),
      false,
      'PostToolUse(성공)에 실패 핸들러를 붙이면 안 된다'
    );
  });
});
