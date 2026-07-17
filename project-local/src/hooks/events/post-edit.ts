/**
 * PostToolUse (Edit/Write) 이벤트 핸들러
 * post-tool-edit.sh 기능을 TypeScript로 재현
 * stdout 출력 없음 (0 bytes)
 */

import { chmodSync } from 'node:fs';
import type { ContextDB } from '../../shared/db.js';
import type { PostToolUseInput, RawHookInput } from '../../shared/types.js';

/**
 * 파싱 경계용 타입.
 * Edit/Write의 tool_response는 Bash와 형태가 다르므로 여기서는 참조하지 않는다.
 * 실측 구조는 shared/types.ts의 PostToolUseInput 참조.
 */
type RawPostEditInput = RawHookInput<
  Omit<PostToolUseInput, 'tool_input' | 'tool_response'>
> & {
  tool_input?: {
    file_path?: string;
    [key: string]: unknown;
  };
};

interface PostEditInput {
  projectRoot: string;
  db: ContextDB;
  stdinData: string;
}

export async function handlePostEdit({ projectRoot, db, stdinData }: PostEditInput): Promise<void> {
  if (!stdinData) return;

  let input: RawPostEditInput;
  try {
    input = JSON.parse(stdinData) as RawPostEditInput;
  } catch {
    return;
  }

  const filePath = input.tool_input?.file_path;
  if (!filePath) return;

  // 프로젝트 상대 경로 변환
  const relPath = filePath.startsWith(projectRoot + '/')
    ? filePath.slice(projectRoot.length + 1)
    : filePath;

  // 실제 도구명을 그대로 기록한다. 하드코딩 시 Write/NotebookEdit 등이 모두 'Edit'으로 뭉개진다.
  // tool_name이 없는 비정상 입력에서만 기존 동작('Edit')으로 폴백한다.
  const toolName = input.tool_name ?? 'Edit';

  const sessionId = db.sessionCurrent();
  if (sessionId > 0) {
    db.toolLog(sessionId, toolName, relPath);
  }

  // .sh 파일을 Write로 생성한 경우 자동 chmod +x (non-blocking)
  if (filePath.endsWith('.sh') && input.tool_name === 'Write') {
    try {
      chmodSync(filePath, 0o755);
    } catch {
      // ignore
    }
  }
}
