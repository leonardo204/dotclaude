/**
 * SubagentStop 핸들러 — 서브에이전트가 멈추려 할 때 ralph persist 판정만 수행한다.
 *
 * settings.json에서 matcher "ralph"로 등록되므로 ralph 서브에이전트에서만 발동하지만,
 * 판정 함수가 agent_type을 다시 확인하므로 matcher가 넓어져도 다른 에이전트는 막히지 않는다.
 *
 * 세션 통계·handoff·알림은 메인 세션 Stop(stop.ts)의 몫이라 여기서 하지 않는다.
 * DB도 필요 없다 — 판정은 .ralph_state 파일만 본다.
 *
 * stdout 불변식: JSON 1개(block) 또는 무출력. Stop과 같은 JSON 프로토콜이며
 * block의 reason은 서브에이전트의 다음 지시로 전달된다(공식 문서).
 */

import { evaluateRalphBlock } from './stop-ralph.js';

export interface SubagentStopHandlerInput {
  projectRoot: string;
  stdinData: string;
}

export function handleSubagentStop({ projectRoot, stdinData }: SubagentStopHandlerInput): void {
  let block = null;
  try {
    block = evaluateRalphBlock({ projectRoot, stdinData });
  } catch (err) {
    // 판정 실패가 서브에이전트 종료를 막으면 안 된다 — 진단만 stderr로.
    process.stderr.write(`[hook:subagent-stop] ralph 판정 실패: ${String(err)}\n`);
  }
  if (block) {
    process.stdout.write(JSON.stringify(block, null, 2) + '\n');
  }
}
