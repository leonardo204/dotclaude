/**
 * Stop (Ralph persist) 판정 — 통합 Stop 핸들러(stop.ts)의 3단계.
 * ralph-persist.sh 기능을 TypeScript로 재현.
 *
 * 활성 + 미완료 → block 응답을 **반환**한다. 비활성 → null.
 *
 * 왜 여기서 stdout에 쓰지 않는가:
 *   Stop 훅이 3개에서 1개로 통합되면서 stdout 출력 책임이 stop.ts로 단일화됐다.
 *   판정(순수)과 출력(부수효과)을 나눠야 "stdout엔 JSON 하나만"을 불변식으로 강제하고
 *   테스트로 고정할 수 있다. block 동작 자체는 ralph 에이전트가 의존하는
 *   검증된 기능이므로 판정 규칙은 한 글자도 바꾸지 않는다.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { RawHookInput, StopInput } from '../../shared/types.js';

interface RalphState {
  active?: boolean;
  status?: string;
  iteration?: number;
  goal?: string;
}

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
  let hookInput: RawHookInput<StopInput> = {};
  if (stdinData) {
    try {
      hookInput = JSON.parse(stdinData) as RawHookInput<StopInput>;
    } catch {
      // 빈 문자열이나 파싱 실패 시 무시
    }
  }

  // stop_hook_active 체크 — 무한 루프 방지
  if (hookInput.stop_hook_active === true) return null;

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

  // 활성 + 미완료일 때만 차단
  if (active && status !== 'completed') {
    return {
      decision: 'block',
      reason: 'prompt',
      systemMessage:
        'Ralph 모드 활성: 태스크 미완료 상태입니다. .claude/.ralph_state를 확인하고 작업을 계속하세요.',
    };
  }
  return null;
}
