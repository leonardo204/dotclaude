/**
 * Stop (Ralph persist) 이벤트 핸들러
 * ralph-persist.sh 기능을 TypeScript로 재현
 * 활성 + 미완료 → {"decision":"block"} JSON 출력
 * 비활성: 아무것도 안 함
 */

import { readFileSync, existsSync } from 'node:fs';

interface RalphState {
  active?: boolean;
  status?: string;
  iteration?: number;
  goal?: string;
}

interface StopInput {
  stop_hook_active?: boolean;
  reason?: string;
}

interface StopRalphInput {
  projectRoot: string;
  stdinData: string;
}

export async function handleStopRalph({ projectRoot, stdinData }: StopRalphInput): Promise<void> {
  const ralphStatePath = `${projectRoot}/.claude/.ralph_state`;

  // ralph 상태 파일 없으면 즉시 종료
  if (!existsSync(ralphStatePath)) return;

  // stdin에서 Stop hook input 읽기
  let hookInput: StopInput = {};
  if (stdinData) {
    try {
      hookInput = JSON.parse(stdinData) as StopInput;
    } catch {
      // 빈 문자열이나 파싱 실패 시 무시
    }
  }

  // stop_hook_active 체크 — 무한 루프 방지
  if (hookInput.stop_hook_active === true) return;

  // ralph 상태 파싱
  let ralphState: RalphState = {};
  try {
    const raw = readFileSync(ralphStatePath, 'utf8');
    ralphState = JSON.parse(raw) as RalphState;
  } catch {
    return;
  }

  const active = ralphState.active === true;
  const status = ralphState.status ?? 'unknown';

  // 활성 + 미완료일 때만 차단
  if (active && status !== 'completed') {
    const blockResponse = {
      decision: 'block',
      reason: 'prompt',
      systemMessage:
        'Ralph 모드 활성: 태스크 미완료 상태입니다. .claude/.ralph_state를 확인하고 작업을 계속하세요.',
    };
    process.stdout.write(JSON.stringify(blockResponse, null, 2) + '\n');
  }
}
