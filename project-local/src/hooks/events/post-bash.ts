/**
 * PostToolUse (Bash) 이벤트 핸들러
 *
 * PostToolUse는 "After a tool call succeeds" — 즉 여기 오는 명령은 **exit 0이다**.
 * 실패한 명령은 PostToolUseFailure로 가므로 post-bash-failure.ts가 처리한다.
 *
 * 그래서 이 경로에는 감지 게이트가 필요하다: 성공했는데 에러 문구를 출력한
 * 경우만 잡아야 한다. 게이트가 넓으면 오탐이 난다 (구 게이트 /error|failed|fatal/가
 * "Found 0 errors" 류를 잡아 가짜 37행을 만들었다).
 *
 * 에러 감지 시 분류 → errors INSERT + error_context 저장. 정상 시 아무것도 안 함.
 * stdout 출력 없음 (0 bytes)
 */

import type { ContextDB } from '../../shared/db.js';
import type {
  BashToolResponse,
  PostToolUseInput,
  RawHookInput,
} from '../../shared/types.js';
import { classifyError, extractFile, looksLikeError } from '../error-classify.js';

/**
 * 파싱 경계용 타입.
 * stdout/stderr은 tool_response 하위에만 존재한다 (최상위에는 없다).
 * 실측 구조는 shared/types.ts의 PostToolUseInput 참조.
 */
type RawPostBashInput = RawHookInput<Omit<PostToolUseInput, 'tool_response'>> & {
  tool_response?: Partial<BashToolResponse>;
};

interface PostBashInput {
  projectRoot: string;
  db: ContextDB;
  stdinData: string;
}

export async function handlePostBash({ db, stdinData }: PostBashInput): Promise<void> {
  if (!stdinData) return;

  let input: RawPostBashInput;
  try {
    input = JSON.parse(stdinData) as RawPostBashInput;
  } catch {
    return;
  }

  // Bash 실행 결과는 tool_response 하위에 중첩돼 있다.
  const result = input.tool_response;
  const combined = (result?.stderr ?? '') + (result?.stdout ?? '');
  if (!combined) return;

  // 성공 경로이므로 게이트가 먼저다. 에러 시그니처가 없으면 그냥 정상 출력이다.
  if (!looksLikeError(combined)) return;

  const errType = classifyError(combined);
  const errFile = extractFile(combined);

  try {
    // 에러 INSERT (session_id는 errorLog 내부에서 자동 조회)
    db.errorLog(errType, errFile || undefined);

    // error_context 자동 캡처
    const errInfo = `${errType}: ${errFile || 'unknown'}`;
    db.liveSet('error_context', errInfo);
  } catch {
    // 훅 실패가 Claude 사용을 막으면 안 된다. 조용히 넘어간다.
  }

  // stdout 출력 없음
}
