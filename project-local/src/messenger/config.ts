/**
 * 메신저 설정 파일 (~/.claude/messenger.json) 읽기/쓰기
 *
 * 배경 — 왜 bash를 버렸나:
 *   구 write_config()는 node -e 에 넘길 **JS 소스 문자열**에 토큰을 그대로 보간했다.
 *     node -e "const config = { bot_token: '${token}', ... }"
 *   토큰에 작은따옴표/개행/`'; rm -rf /; //` 가 들어가면 문법이 깨지거나
 *   임의 코드가 실행된다. 값은 코드가 아니라 데이터로 다뤄야 한다
 *   → JSON.stringify + writeFileSync.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** messenger.json의 스키마. 파일에 기록되는 키 순서도 이 순서를 따른다. */
export interface MessengerConfig {
  bot_token: string;
  chat_id: string;
  enabled: boolean;
  min_duration: number;
  scope: string;
}

/** 소유자만 읽기/쓰기. 봇 토큰이 평문으로 들어 있으므로 필수. */
const CONFIG_MODE = 0o600;

/**
 * HOME 기준 경로.
 * bash가 `${HOME}` 을 썼으므로 동일하게 env를 우선한다 (테스트가 HOME을 갈아끼운다).
 */
export function homeDir(): string {
  return process.env.HOME || homedir();
}

/** 설정 파일의 절대 경로. */
export function configPath(home: string = homeDir()): string {
  return join(home, '.claude', 'messenger.json');
}

/**
 * 설정을 읽는다. 파일이 없으면 null.
 *
 * bash read_config()의 동작을 그대로 따른다 — 특히 **파일이 있는데 JSON이 깨진 경우**:
 * bash는 각 node -e 를 `|| true` / `|| echo <기본값>` 로 감싸서
 * "읽기 성공 + 전 필드 기본값" 으로 진행했다. 실패로 취급하지 않는다.
 * (status가 '설정 파일 없음' 대신 빈 값을 보여주는 이유)
 */
export function readConfig(path: string = configPath()): MessengerConfig | null {
  if (!existsSync(path)) return null;

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // 깨진 JSON — bash와 동일하게 기본값으로 진행한다
    parsed = {};
  }
  const c: Record<string, unknown> =
    parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};

  // 아래 falsy 처리(`|| ''`, `|| 0`)는 bash의 node -e 표현식과 1:1로 맞춘 것이다.
  const minRaw = c.min_duration ? Number(c.min_duration) : 0;

  return {
    bot_token: c.bot_token ? String(c.bot_token) : '',
    chat_id: c.chat_id ? String(c.chat_id) : '',
    enabled: c.enabled === false ? false : true,
    min_duration: Number.isFinite(minRaw) ? minRaw : 0,
    scope: c.scope ? String(c.scope) : 'global',
  };
}

/**
 * 설정을 저장한다. 디렉토리를 만들고 항상 0600으로 잠근다.
 *
 * 주의: writeFileSync의 mode 옵션은 **파일을 새로 만들 때만** 적용된다.
 * 기존 파일을 덮어쓰면 기존 권한이 유지되므로 chmod를 명시적으로 한 번 더 건다.
 * (bash도 write 후 `chmod 600` 을 별도로 호출했다)
 */
export function writeConfig(config: MessengerConfig, path: string = configPath()): void {
  mkdirSync(dirname(path), { recursive: true });

  // 값은 데이터다. 문자열 보간이 아니라 직렬화로 기록한다.
  const json =
    JSON.stringify(
      {
        bot_token: config.bot_token,
        chat_id: config.chat_id,
        enabled: config.enabled,
        min_duration: config.min_duration,
        scope: config.scope,
      },
      null,
      2
    ) + '\n';

  writeFileSync(path, json, { mode: CONFIG_MODE });
  chmodSync(path, CONFIG_MODE);
}
