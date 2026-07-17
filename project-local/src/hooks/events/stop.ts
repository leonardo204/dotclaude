/**
 * Stop 통합 핸들러 — 구 stop-session · stop-ralph · `messenger.sh notify &` 3개를 합친 것.
 *
 * 왜 합쳤나 (경합):
 *   같은 이벤트에 등록된 훅들은 **병렬로 실행된다**(공식 문서 확정). 구 배선에서는
 *   `messenger.sh notify`가 `&`로 백그라운드에 떨어져, stop-session이
 *   session_handoff/session_summary를 **쓰기도 전에** 알림이 그 값을 읽을 수 있었다.
 *   훅을 더 붙이는 방식으로는 순서를 못 준다 — 한 프로세스 안에서 순차 호출해야 한다.
 *
 * 실행 순서 (이 순서가 곧 계약이다):
 *   1. 세션 통계 기록
 *   2. session_summary / session_handoff 쓰기      ← 1·2는 handleStopSession이 담당
 *   3. ralph 판정 (순수 — 출력은 5단계)
 *   4. 알림 전송                                    ← 2번 뒤라 handoff 경합이 구조적으로 없다
 *   5. stdout에 JSON 1개만 출력 (또는 무출력)
 *
 * stdout 불변식:
 *   Stop 채널의 stdout은 JSON 프로토콜 전용이다. 이 파일이 stdout에 쓰는 **유일한** 지점은
 *   5단계 하나뿐이다. 1~4단계의 진단 출력은 전부 stderr로 간다.
 */

import type { ContextDB } from '../../shared/db.js';
import type { RawHookInput, StopInput } from '../../shared/types.js';
import { runStopNotify, type StopNotifyOptions } from '../../messenger/notify.js';
import { handleStopSession } from './stop-session.js';
import { evaluateRalphBlock, type RalphBlockResponse } from './stop-ralph.js';

/**
 * 알림 전체 상한.
 *
 * 구 배선은 `&`로 던져서 Stop을 지연시키지 않았다. 이제 in-process이므로 상한이 필요하다.
 * 훅 기본 타임아웃은 600초지만 사용자 터미널이 그만큼 멈추면 안 된다.
 * 실효 상한은 notify.ts의 STOP_SEND_TIMEOUT_MS(전송 4초) + git 1초이고,
 * 이 레이스는 그 위에 두는 구조적 안전장치다.
 */
const NOTIFY_TIMEOUT_MS = 5000;

export interface StopHandlerInput {
  projectRoot: string;
  db: ContextDB | null;
  stdinData: string;
  /** 테스트/E2E 주입용. 실제 훅 경로에서는 지정하지 않는다. */
  notify?: Partial<StopNotifyOptions>;
}

/** 상한을 넘기면 기다리기를 포기한다. 타이머는 unref — 이것 때문에 종료가 늦으면 안 된다. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return await new Promise<T | 'timeout'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    if (typeof timer.unref === 'function') timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve('timeout');
      }
    );
  });
}

function parseStop(stdinData: string): RawHookInput<StopInput> {
  if (!stdinData) return {};
  try {
    return JSON.parse(stdinData) as RawHookInput<StopInput>;
  } catch {
    // 훅 stdin은 외부 입력이다 — 파싱 실패가 Stop을 죽이면 안 된다
    return {};
  }
}

export async function handleStop({
  projectRoot,
  db,
  stdinData,
  notify,
}: StopHandlerInput): Promise<void> {
  const stop = parseStop(stdinData);

  // 1~2. 세션 통계 + session_summary/session_handoff 기록.
  //      반드시 4단계(알림)보다 먼저다 — 알림이 방금 쓴 handoff를 읽는다.
  if (db) {
    try {
      await handleStopSession({ db });
    } catch (err) {
      process.stderr.write(`[hook:stop] 세션 통계 실패: ${String(err)}\n`);
    }
  }

  // 3. ralph 판정. 출력은 5단계에서 한 번에 한다.
  let block: RalphBlockResponse | null = null;
  try {
    block = evaluateRalphBlock({ projectRoot, stdinData });
  } catch (err) {
    process.stderr.write(`[hook:stop] ralph 판정 실패: ${String(err)}\n`);
  }

  // 4. 알림. 실패·타임아웃이 Stop을 막지 않는다.
  try {
    await withTimeout(
      runStopNotify({ db, projectRoot, stop, ...notify }),
      NOTIFY_TIMEOUT_MS
    );
  } catch (err) {
    process.stderr.write(`[hook:stop] 알림 실패: ${String(err)}\n`);
  }

  // 5. stdout: JSON 1개 또는 무출력. 이 파일에서 stdout에 쓰는 유일한 지점이다.
  if (block) {
    process.stdout.write(JSON.stringify(block, null, 2) + '\n');
  }
}
