/**
 * Stop (세션 통계) 이벤트 핸들러
 * on-stop.sh 기능을 TypeScript로 재현
 * stdout: 디버그 1줄 (또는 0)
 */

import type { ContextDB } from '../../shared/db.js';

interface StopSessionInput {
  db: ContextDB;
}

export async function handleStopSession({ db }: StopSessionInput): Promise<void> {
  const sessionId = db.sessionCurrent();
  if (sessionId <= 0) return;

  // 편집 파일 수 조회
  let filesChanged = 0;
  try {
    filesChanged = db.sessionEditCount(sessionId);
  } catch {
    // 무시
  }

  // 세션 업데이트
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    db.sessionUpdate(sessionId, { end_time: now, files_changed: filesChanged });
  } catch {
    // 무시
  }

  // session_summary 자동 저장
  try {
    const files = db.recentToolFiles(sessionId, 10);
    if (files.length > 0) {
      const fileList = files.join(', ');
      const summary =
        filesChanged > 10
          ? `${filesChanged} files: ${fileList}, ... +${filesChanged - 10} more`
          : `${filesChanged} files: ${fileList}`;
      db.liveSet('session_summary', summary);
    }
  } catch {
    // 무시
  }

  // stdout: 디버그 1줄
  process.stdout.write(`[hook:on-stop] DB 조회: 세션 #${sessionId} 편집 파일 수\n`);
}
