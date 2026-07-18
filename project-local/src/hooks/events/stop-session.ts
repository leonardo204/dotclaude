/**
 * Stop (세션 통계) 단계 — 통합 Stop 핸들러(stop.ts)의 1~2단계.
 * on-stop.sh 기능을 TypeScript로 재현.
 *
 * stdout: **아무것도 쓰지 않는다.** Stop 채널의 stdout은 JSON 프로토콜 전용이고
 * 그 출력은 stop.ts가 단독으로 책임진다. 진단 출력은 stderr로 간다.
 */

import type { ContextDB } from '../../shared/db.js';

interface StopSessionInput {
  db: ContextDB;
}

/**
 * 로컬 타임존 기준 'YYYY-MM-DD HH:MM:SS' 문자열을 만든다.
 *
 * start_time은 db.ts가 SQLite의 datetime('now','localtime')으로 기록한다.
 * end_time을 toISOString()(UTC)으로 저장하면 두 값의 타임존이 어긋나
 * 종료 시각이 시작 시각보다 앞서는 세션이 생긴다(실측: 세션 60, start 09:44 → end 05:57).
 * 따라서 end_time도 반드시 로컬 시각으로 통일한다.
 */
export function localTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
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
  // start_time(db.ts의 datetime('now','localtime'))과 타임존을 맞춘다.
  const now = localTimestamp();
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
    if (parts.length > 0) {
      db.liveSet(
        'session_handoff',
        `[handoff] 직전 세션 #${sessionId} 요약:\n${parts.join('\n')}`
      );
    }
  } catch {
    // 무시
  }

  // 진단 출력은 **stderr**로 간다.
  // 과거 이 줄은 stdout으로 나갔다. Stop의 stdout은 JSON 프로토콜 전용이라
  // (stop-ralph가 {"decision":"block"}을 내보내는 바로 그 채널이다) 비-JSON을 섞으면 안 된다.
  // 훅이 별도 프로세스로 나뉘어 있던 동안엔 우연히 무해했을 뿐, 통합된 지금은 곧바로 오염이다.
  process.stderr.write(`[hook:on-stop] DB 조회: 세션 #${sessionId} 편집 파일 수\n`);
}
