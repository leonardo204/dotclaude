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

  // duration_minutes 계산
  let durationMinutes: number | undefined;
  try {
    const session = db.sessionInfo(sessionId);
    if (session?.start_time) {
      const startMs = new Date(session.start_time).getTime();
      durationMinutes = Math.round((Date.now() - startMs) / 60000);
    }
  } catch {
    // 무시
  }

  // 세션 업데이트 (end_time + files_changed + duration_minutes 한 번에)
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    const updateData: Partial<Omit<import('../../shared/types.js').SessionInfo, 'id'>> = {
      end_time: now,
      files_changed: filesChanged,
    };
    if (durationMinutes !== undefined) {
      updateData.duration_minutes = durationMinutes;
    }
    db.sessionUpdate(sessionId, updateData);
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

  // A1: 다음 세션 핸드오프 블록 — 구조화 저장(편집/커밋/결정/미완료 태스크).
  // SessionStart가 이 블록을 주입해 세션 간 연속성을 확보한다(LLM 요약 아님).
  try {
    const parts: string[] = [];
    const files = db.recentToolFiles(sessionId, 8);
    if (filesChanged > 0 || files.length > 0) {
      const fileList = files.join(', ');
      parts.push(`  - 편집: ${filesChanged} files${fileList ? ` (${fileList})` : ''}`);
    }
    const commitRows = db.query(
      `SELECT message FROM commits WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 5`
    ) as Array<{ message: string }>;
    if (commitRows.length > 0) {
      const msgs = commitRows.map((r) => r.message.split('\n')[0]).join(' / ');
      parts.push(`  - 커밋: ${commitRows.length}건 — ${msgs}`);
    }
    const decisionRows = db.query(
      "SELECT description FROM decisions WHERE status='active' ORDER BY id DESC LIMIT 2"
    ) as Array<{ description: string }>;
    if (decisionRows.length > 0) {
      parts.push(`  - 최근 결정: ${decisionRows.map((r) => r.description).join(' / ')}`);
    }
    const taskRows = db.query(
      "SELECT '    - [' || status || '] ' || description AS line FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority LIMIT 5"
    ) as Array<{ line: string }>;
    if (taskRows.length > 0) {
      parts.push(`  - 미완료 태스크 ${taskRows.length}건:`);
      for (const r of taskRows) parts.push(r.line);
    }
    if (parts.length > 0) {
      db.liveSet(
        'session_handoff',
        `[handoff] 직전 세션 #${sessionId} 요약:\n${parts.join('\n')}`
      );
    }
  } catch {
    // 무시
  }

  // stdout: 디버그 1줄
  process.stdout.write(`[hook:on-stop] DB 조회: 세션 #${sessionId} 편집 파일 수\n`);
}
