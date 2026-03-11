/**
 * SessionStart 이벤트 핸들러
 * session-start.sh 기능을 TypeScript로 재현
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ContextDB } from '../../shared/db.js';

interface SessionStartInput {
  projectRoot: string;
  db: ContextDB;
}

export async function handleSessionStart({ projectRoot, db }: SessionStartInput): Promise<void> {
  const out: string[] = [];

  // === .project_root 캐시 생성 (나머지 hook에서 git rev-parse 오버헤드 제거) ===
  try {
    const projectRootFile = join(projectRoot, '.claude/.project_root');
    writeFileSync(projectRootFile, projectRoot, 'utf8');
  } catch {
    // 무시 — 캐시 없으면 다른 hook이 git rev-parse로 fallback
  }

  // === DB 초기화 ===
  const initSqlPath = join(projectRoot, '.claude/db/init.sql');
  if (existsSync(initSqlPath)) {
    db.initSchema(initSqlPath);
  }

  // === 마지막 세션 조회 (새 세션 생성 전) ===
  let lastSessionTime: string | null = null;
  try {
    const rows = db.query(
      'SELECT start_time FROM sessions ORDER BY id DESC LIMIT 1'
    ) as Array<{ start_time: string }>;
    if (rows.length > 0) {
      lastSessionTime = rows[0].start_time;
    }
  } catch {
    // 세션 테이블 없으면 무시
  }

  // === 새 세션 생성 ===
  const sessionId = db.sessionCreate();

  // === live_context 세션 스코프 초기화 ===
  try {
    db.execRaw("DELETE FROM live_context WHERE key IN ('working_files', 'error_context')");
  } catch {
    // 무시
  }

  // === CLAUDE.md 파싱 → DB 저장 ===
  // 글로벌 CLAUDE.md
  const globalMd = join(process.env['HOME'] ?? '', '.claude/CLAUDE.md');
  if (existsSync(globalMd)) {
    try {
      const content = readFileSync(globalMd, 'utf8');
      const lines = content.split('\n');
      const rules: string[] = [];
      let inSection = false;
      for (const line of lines) {
        if (line.startsWith('## ')) inSection = true;
        if (line === '---') inSection = false;
        if (inSection && (line.startsWith('- **') || line.startsWith('**') || line.startsWith('### '))) {
          rules.push(line);
          if (rules.length >= 20) break;
        }
      }
      if (rules.length > 0) {
        db.liveSet('_rules', rules.join('\n'));
      }
    } catch {
      // 무시
    }
  }

  // 프로젝트 CLAUDE.md
  const projectMd = join(projectRoot, 'CLAUDE.md');
  if (existsSync(projectMd)) {
    try {
      const content = readFileSync(projectMd, 'utf8');
      const lines = content.split('\n');
      const proj: string[] = [];
      let inSection = false;
      for (const line of lines) {
        if (line.startsWith('## PROJECT')) inSection = true;
        if (inSection && line === '---') break;
        if (inSection) {
          proj.push(line);
          if (proj.length >= 30) break;
        }
      }
      if (proj.length > 0) {
        db.liveSet('_project_rules', proj.join('\n'));
      }
    } catch {
      // 무시
    }
  }

  // === 간격 계산 ===
  let diffHours = 9999;
  if (lastSessionTime) {
    try {
      const lastTs = new Date(lastSessionTime).getTime();
      const nowTs = Date.now();
      diffHours = Math.floor((nowTs - lastTs) / 3600000);
    } catch {
      diffHours = 0;
    }
  }

  // === 날짜/요일 ===
  const now = new Date();
  const nowStr = now.toISOString().replace('T', ' ').slice(0, 19);
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  out.push(`[checkin] Session #${sessionId} started: ${nowStr} (${weekday})`);

  if (diffHours >= 24) {
    out.push(`[checkin] Last session: ${lastSessionTime} (${diffHours}h ago - LONG BREAK)`);
    out.push('[checkin] Action needed: full briefing recommended');

    // 미완료 태스크
    try {
      const pendingRows = db.query(
        "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('pending','in_progress')"
      ) as Array<{ n: number }>;
      const pending = pendingRows[0]?.n ?? 0;
      if (pending > 0) {
        out.push(`[checkin] Pending tasks: ${pending}`);
        const taskRows = db.query(
          "SELECT '  - [' || status || '] ' || description AS line FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority LIMIT 5"
        ) as Array<{ line: string }>;
        for (const r of taskRows) out.push(r.line);
      }
    } catch {
      // 무시
    }
  } else if (diffHours >= 4) {
    out.push(`[checkin] Last session: ${lastSessionTime} (${diffHours}h ago - moderate break)`);
    out.push('[checkin] Quick sync recommended');
  } else {
    out.push(`[checkin] Last session: ${lastSessionTime} (${diffHours}h ago - recent)`);
  }

  // === 커스텀 명령어 안내 ===
  const commandsDir = join(projectRoot, '.claude/commands');
  out.push('');
  out.push('[project] Available commands:');
  if (existsSync(commandsDir)) {
    try {
      const files = readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const cmdName = basename(file, '.md');
        const cmdPath = join(commandsDir, file);
        const firstLine = readFileSync(cmdPath, 'utf8').split('\n')[0] ?? '';
        out.push(`  /project:${cmdName.padEnd(10)} - ${firstLine}`);
      }
    } catch {
      // 무시
    }
  }

  process.stdout.write(out.join('\n') + '\n');
}
