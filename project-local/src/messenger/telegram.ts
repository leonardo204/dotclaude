/**
 * Telegram Bot API 전송
 *
 * 채널 추상화(Channel 인터페이스)를 일부러 두지 않는다. 채널이 하나뿐이고,
 * 폴링(getUpdates/offset)은 Telegram 고유라 send-only 인터페이스에 들어가지 않는다.
 * 평범한 export 함수로 충분하다.
 *
 * 배경 — 왜 로깅을 넣나:
 *   구 구현은 Stop 훅에서 `send_telegram ... >/dev/null 2>&1 || true` 로 호출돼
 *   전송 실패가 어디에도 남지 않았다. HTML 파싱 400으로 알림이 통째 사라져도
 *   사용자는 "원래 안 오는 건가" 하고 넘어갔다. 실패는 흔적을 남겨야 한다.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { setDefaultAutoSelectFamily } from 'node:net';
import { dirname, join } from 'node:path';
import { homeDir } from './config.js';
import { redact } from './format.js';

/** 로그 회전 임계치. 훅마다 append되므로 무한 증가를 막는다. */
const LOG_MAX_BYTES = 256 * 1024;
/** 전송 상한. 훅에서 호출되므로 무한 대기하면 Claude가 멈춘다. */
const SEND_TIMEOUT_MS = 15_000;

export interface SendResult {
  ok: boolean;
  /** 실패 사유(사용자 노출용). bash와 동일한 문구를 유지한다. */
  description: string;
}

export interface SendOptions {
  /** 테스트 주입용. 미지정 시 전역 fetch. */
  fetchImpl?: typeof fetch;
  /** 테스트 주입용 로그 경로. */
  logFile?: string;
  timeoutMs?: number;
}

/** 실패 로그 경로. */
export function logPath(home: string = homeDir()): string {
  return join(home, '.claude', 'messenger.log');
}

let familyPolicyApplied = false;

/**
 * 실제 전송에 쓸 fetch를 돌려준다. 최초 1회 주소 패밀리 정책을 손본다.
 *
 * 왜 필요한가 (실측):
 *   node 20+ 의 autoSelectFamily(Happy Eyeballs)가 기본 켜져 있는데,
 *   IPv6 경로가 없는 회선에서 api.telegram.org 연결이 ETIMEDOUT으로 죽는다.
 *   같은 머신에서 관측한 결과:
 *     curl https://api.telegram.org/          → 302 (정상)
 *     node fetch(...)                         → TypeError: fetch failed / ETIMEDOUT
 *     node net.connect(149.154.166.110:443)   → 성공
 *     node tls.connect(api.telegram.org:443)  → 핸드셰이크 성공
 *     node https.get({autoSelectFamily:false})→ 302 (정상)
 *     curl -6 https://api.telegram.org/       → 실패 (IPv6 경로 없음)
 *   즉 회선은 열려 있고 Happy Eyeballs의 폴백만 제 역할을 못 한다.
 *
 * 구현이 bash+curl 이었을 땐 curl이 IPv4로 알아서 폴백해 이 문제가 드러나지 않았다.
 * 이 설정을 빼면 TS 전환 자체가 "알림이 아예 안 가는" 회귀가 된다.
 * false로 두면 node 20 이전과 같이 OS 리졸버 순서를 그대로 신뢰한다
 * (macOS는 IPv6 경로가 없으면 IPv4를 먼저 준다 — 위 dns.lookup 실측으로 확인).
 *
 * 주입된 fetchImpl(테스트)에는 적용하지 않는다 — 실제 소켓을 열지 않으므로 불필요하다.
 */
function defaultFetch(): typeof fetch {
  if (!familyPolicyApplied) {
    familyPolicyApplied = true;
    try {
      setDefaultAutoSelectFamily(false);
    } catch {
      // 지원하지 않는 런타임 — 기본 동작으로 진행
    }
  }
  return fetch;
}

/** 크기가 임계치를 넘으면 .1 로 넘기고 새로 시작한다 (백업 1세대만 유지). */
function rotateIfNeeded(path: string): void {
  try {
    if (statSync(path).size >= LOG_MAX_BYTES) {
      renameSync(path, `${path}.1`);
    }
  } catch {
    // 파일 없음 = 회전 불필요
  }
}

/**
 * 한 줄을 로그에 남긴다. **기록 전 반드시 redact를 통과시킨다.**
 * 로깅 실패가 알림 경로를 죽이면 안 되므로 전부 삼킨다.
 */
export function logLine(message: string, file: string = logPath()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    rotateIfNeeded(file);
    const line = `${new Date().toISOString()} ${redact(message)}\n`;
    appendFileSync(file, line, { mode: 0o600 });
  } catch {
    // 무시 — 로깅은 부수적 관심사다
  }
}

/**
 * 메시지를 전송한다.
 *
 * @param html **이미 이스케이프/조립이 끝난** 본문을 받는다.
 *   여기서 자동 이스케이프하지 않는 이유: 그러면 호출부가 <b> 서식을 넣을 수 없다.
 *   평문을 보내려면 호출부에서 escapeHtml()을, 서식을 넣으려면 bold()를 쓴다.
 */
export async function sendMessage(
  token: string,
  chatId: string,
  html: string,
  options: SendOptions = {}
): Promise<SendResult> {
  const f = options.fetchImpl ?? defaultFetch();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = new URLSearchParams({
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
  });

  let raw: string;
  let status = 0;
  try {
    const res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? SEND_TIMEOUT_MS),
    });
    status = res.status;
    raw = await res.text();
  } catch (err) {
    // 네트워크/타임아웃. bash는 curl 실패 시 빈 응답 → '파싱 실패' 로 귀결됐다.
    logLine(`send failed (network): ${String(err)} url=${url}`, options.logFile);
    return { ok: false, description: '파싱 실패' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logLine(`send failed (unparseable response): HTTP ${status} body=${raw} url=${url}`, options.logFile);
    return { ok: false, description: '파싱 실패' };
  }

  const r = (parsed !== null && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  if (r.ok) {
    return { ok: true, description: '' };
  }

  const description = typeof r.description === 'string' && r.description ? r.description : '알 수 없는 오류';
  // 응답 본문과 URL 양쪽에 토큰이 들어갈 수 있다. logLine이 redact한다.
  logLine(`send failed: HTTP ${status} body=${raw} url=${url}`, options.logFile);
  return { ok: false, description };
}
