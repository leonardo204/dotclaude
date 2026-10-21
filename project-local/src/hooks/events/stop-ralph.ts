/**
 * Ralph persist 판정 — SubagentStop(`subagent-stop`)과 통합 Stop 핸들러(stop.ts) 3단계가 공유한다.
 * ralph-persist.sh 기능을 TypeScript로 재현.
 *
 * ralph 자신이 멈추려 할 때 + 활성 + 미완료 → block 응답을 **반환**한다. 그 외 → null.
 *
 * 왜 agent_type을 보는가:
 *   ralph는 서브에이전트다. 서브에이전트가 멈출 때는 `Stop`이 아니라 `SubagentStop`이 발동한다.
 *   예전엔 이 판정이 `Stop`(메인 세션)에만 붙어 있어서, ralph를 백그라운드로 띄운 동안
 *   **메인 세션의 턴 종료**가 계속 막혔다(정작 ralph 자신은 한 번도 막히지 않았다).
 *   `.ralph_state`는 "누가 멈추는지"를 모르므로, 훅 입력의 `agent_type`으로 판정 대상을 한정한다.
 *   - SubagentStop: `agent_type`은 서브에이전트 이름이다 (matcher로도 ralph만 받는다).
 *   - Stop: `claude --agent ralph`로 메인 세션 자체가 ralph일 때만 `agent_type: "ralph"`가 온다.
 *
 * 왜 여기서 stdout에 쓰지 않는가:
 *   Stop 훅이 3개에서 1개로 통합되면서 stdout 출력 책임이 stop.ts로 단일화됐다
 *   (SubagentStop은 subagent-stop.ts가 같은 방식으로 출력한다).
 *   판정(순수)과 출력(부수효과)을 나눠야 "stdout엔 JSON 하나만"을 불변식으로 강제하고
 *   테스트로 고정할 수 있다. active/status/stale/stop_hook_active 규칙은 그대로이고,
 *   달라진 것은 "누가 멈출 때 판정하는가"(agent_type)와 reason 문구뿐이다.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import type { RawHookInput, StopInput, SubagentStopInput } from '../../shared/types.js';

interface RalphState {
  active?: boolean;
  status?: string;
  iteration?: number;
  goal?: string;
}

/**
 * ralph 상태가 이 시간(ms) 넘게 갱신되지 않았으면 죽은 것으로 본다.
 *
 * ralph 에이전트가 크래시하거나 세션이 재시작되면 .ralph_state가
 * active:true/working 인 채 남아 stop-ralph가 모든 Stop을 계속 block 한다.
 * stop_hook_active 8회 상한이 궁극의 안전판이지만 그때까지 매 턴 낭비된다.
 * 에이전트는 진행 중 파일을 자주 다시 쓰므로(태스크 상태 갱신), 30분 넘게
 * 손대지 않은 상태는 살아있는 ralph 루프가 아니라 좀비다.
 */
const RALPH_STALE_MS = 30 * 60 * 1000;

/** 차단 대상 에이전트 이름 (`.claude/agents/ralph.md`의 name). */
export const RALPH_AGENT_TYPE = 'ralph';

/**
 * block 시 Claude에게 다음 지시로 전달되는 문구.
 * Stop/SubagentStop 모두 `reason`이 "계속해야 하는 이유"로 모델에 전달된다(공식 문서).
 * 예전엔 여기에 'prompt'라는 자리표시자가 들어가 있어 모델/사용자가 매번 "prompt"만 받았다.
 */
export const RALPH_BLOCK_REASON =
  'Ralph 모드 활성: 태스크 미완료 상태입니다. .claude/.ralph_state를 확인하고 남은 태스크를 계속하세요. ' +
  '모든 태스크가 검증까지 끝났다면 .ralph_state의 status를 "completed"로 바꾼 뒤 종료하세요.';

export interface RalphBlockResponse {
  decision: 'block';
  reason: string;
  systemMessage: string;
}

interface EvaluateRalphInput {
  projectRoot: string;
  stdinData: string;
}

export function evaluateRalphBlock({
  projectRoot,
  stdinData,
}: EvaluateRalphInput): RalphBlockResponse | null {
  const ralphStatePath = `${projectRoot}/.claude/.ralph_state`;

  // ralph 상태 파일 없으면 즉시 종료
  if (!existsSync(ralphStatePath)) return null;

  // stdin에서 Stop hook input 읽기
  // 실측 Stop 페이로드 구조는 shared/types.ts의 StopInput 참조 (reason 필드는 없다).
  let hookInput: RawHookInput<StopInput & SubagentStopInput> = {};
  if (stdinData) {
    try {
      hookInput = JSON.parse(stdinData) as RawHookInput<StopInput & SubagentStopInput>;
    } catch {
      // 빈 문자열이나 파싱 실패 시 무시
    }
  }

  // stop_hook_active 체크 — 무한 루프 방지
  if (hookInput.stop_hook_active === true) return null;

  // 멈추려는 주체가 ralph일 때만 판정한다. 메인 세션(agent_type 없음)이나
  // 다른 서브에이전트가 .ralph_state 때문에 막히면 안 된다.
  if (hookInput.agent_type !== RALPH_AGENT_TYPE) return null;

  // ralph 상태 파싱
  let ralphState: RalphState = {};
  try {
    const raw = readFileSync(ralphStatePath, 'utf8');
    ralphState = JSON.parse(raw) as RalphState;
  } catch {
    return null;
  }

  const active = ralphState.active === true;
  const status = ralphState.status ?? 'unknown';

  // stale 감지: 파일 mtime이 너무 오래됐으면 죽은 ralph의 잔재로 보고 차단하지 않는다.
  // 에이전트 협조(timestamp 기록)에 기대지 않도록 파일시스템 mtime을 신뢰한다.
  try {
    const ageMs = Date.now() - statSync(ralphStatePath).mtimeMs;
    if (ageMs > RALPH_STALE_MS) return null;
  } catch {
    return null;
  }

  // 활성 + 미완료일 때만 차단
  if (active && status !== 'completed') {
    return {
      decision: 'block',
      reason: RALPH_BLOCK_REASON,
      systemMessage: RALPH_BLOCK_REASON,
    };
  }
  return null;
}
