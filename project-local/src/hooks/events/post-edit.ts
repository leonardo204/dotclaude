/**
 * PostToolUse (Edit/Write) 이벤트 핸들러
 * post-tool-edit.sh 기능을 TypeScript로 재현
 * stdout 출력 없음 (0 bytes)
 */

import type { ContextDB } from '../../shared/db.js';

interface PostToolUseInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface PostEditInput {
  projectRoot: string;
  db: ContextDB;
  stdinData: string;
}

export async function handlePostEdit({ projectRoot, db, stdinData }: PostEditInput): Promise<void> {
  if (!stdinData) return;

  let input: PostToolUseInput;
  try {
    input = JSON.parse(stdinData) as PostToolUseInput;
  } catch {
    return;
  }

  const filePath = input.tool_input?.file_path;
  if (!filePath) return;

  // 프로젝트 상대 경로 변환
  const relPath = filePath.startsWith(projectRoot + '/')
    ? filePath.slice(projectRoot.length + 1)
    : filePath;

  const sessionId = db.sessionCurrent();
  if (sessionId > 0) {
    db.toolLog(sessionId, 'Edit', relPath);
  }

  // stdout 출력 없음
}
