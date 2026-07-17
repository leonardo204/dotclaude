/**
 * PostToolUseFailure (Bash) 이벤트 핸들러
 *
 * 왜 필요한가: PostToolUse는 공식 문서상 "After a tool call succeeds"다.
 * 즉 실패한 명령은 post-bash.ts에 **도달하지 않는다**. 진짜 실패는 여기로 온다.
 * (실측: exit 2 명령에서 PostToolUse는 발동하지 않음을 확인했다.)
 *
 * 이 훅이 발동했다 = 실패가 확정이다. 따라서 "에러인지" 판정하지 않는다 —
 * 분류만 하고 무조건 기록한다. 단, 사용자 ESC 중단(is_interrupt)은 에러가 아니다.
 *
 * stdout 출력 없음 (0 bytes).
 */

import type { ContextDB } from '../../shared/db.js';
import type { PostToolUseFailureInput, RawHookInput } from '../../shared/types.js';
import { classifyError, extractFile, parseExitCode } from '../error-classify.js';

/**
 * 파싱 경계용 타입.
 * PostToolUse와 달리 tool_response가 없다. 실패 정보는 error 문자열에 있다.
 * 실측 구조는 shared/types.ts의 PostToolUseFailureInput 참조.
 */
type RawPostBashFailureInput = RawHookInput<PostToolUseFailureInput>;

interface PostBashFailureInput {
  projectRoot: string;
  db: ContextDB;
  stdinData: string;
}

export async function handlePostBashFailure({
  db,
  stdinData,
}: PostBashFailureInput): Promise<void> {
  if (!stdinData) return;

  let input: RawPostBashFailureInput;
  try {
    input = JSON.parse(stdinData) as RawPostBashFailureInput;
  } catch {
    return;
  }

  // 사용자가 ESC로 취소한 것은 실패가 아니다. 기록하면 알림 스팸이 된다.
  if (input.is_interrupt === true) return;

  // error가 아예 없으면 우리가 계약한 이벤트가 아니다 (실측상 항상 존재).
  // 빈 문자열은 기록한다 — 출력이 없었을 뿐 실패는 실패다.
  if (typeof input.error !== 'string') return;
  const errorText = input.error;

  // 감지 게이트 없음: 실패가 확정이므로 분류만 한다 (폴백 runtime_error).
  const errType = classifyError(errorText);
  const errFile = extractFile(errorText);
  // 파싱 실패(null)해도 기록은 계속한다.
  const exitCode = parseExitCode(errorText);

  try {
    // errorLog(errorType, filePath) — 컬럼 의미대로 저장한다.
    // 레거시 셸 훅은 error_type 자리에 'Bash'를, file_path 자리에 에러타입을 넣었다.
    db.errorLog(errType, errFile || undefined);

    // error_context 갱신 (post-bash.ts와 동일한 형식 + exit code)
    const suffix = exitCode !== null ? ` (exit ${exitCode})` : '';
    db.liveSet('error_context', `${errType}: ${errFile || 'unknown'}${suffix}`);
  } catch {
    // 훅 실패가 Claude 사용을 막으면 안 된다. 조용히 넘어간다.
  }

  // stdout 출력 없음
}
