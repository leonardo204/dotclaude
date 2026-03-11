/**
 * PostToolUse (Bash) 이벤트 핸들러
 * post-tool-bash.sh 기능을 TypeScript로 재현
 * 에러 감지 시 분류 → errors INSERT + error_context 저장
 * 정상 시 아무것도 안 함
 * stdout 출력 없음 (0 bytes)
 */

import type { ContextDB } from '../../shared/db.js';

interface BashToolResult {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stdout?: string;
  stderr?: string;
  [key: string]: unknown;
}

interface PostBashInput {
  projectRoot: string;
  db: ContextDB;
  stdinData: string;
}

function classifyError(output: string): string {
  const lower = output.toLowerCase();
  if (/error|failed|fatal/.test(lower)) {
    if (/build|compile/.test(lower)) return 'build_fail';
    if (/test/.test(lower)) return 'test_fail';
    if (/conflict/.test(lower)) return 'conflict';
    if (/permission/.test(lower)) return 'permission';
    return 'runtime_error';
  }
  return '';
}

function extractFile(output: string): string {
  const match = output.match(/(?:^|[\s:])([^\s:]+\.[a-zA-Z]{1,10})(?:[\s:]|$)/);
  return match?.[1] ?? '';
}

export async function handlePostBash({ db, stdinData }: PostBashInput): Promise<void> {
  if (!stdinData) return;

  let input: BashToolResult;
  try {
    input = JSON.parse(stdinData) as BashToolResult;
  } catch {
    return;
  }

  const combined = (input.stderr ?? '') + (input.stdout ?? '');
  if (!combined) return;

  const errType = classifyError(combined);
  if (!errType) return;

  const errFile = extractFile(combined);

  // 에러 INSERT (session_id는 errorLog 내부에서 자동 조회)
  db.errorLog(errType, errFile || undefined);

  // error_context 자동 캡처
  const errInfo = `${errType}: ${errFile || 'unknown'}`;
  db.liveSet('error_context', errInfo);

  // stdout 출력 없음
}
