/**
 * UserPromptSubmit 이벤트 핸들러
 * on-prompt.sh 기능을 TypeScript로 재현 (3단계 차등 주입)
 * 핵심: stdout 최소화 — 기본 모드에서 2줄 이하
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { ContextDB } from '../../shared/db.js';

interface CtxState {
  current?: number;
  previous?: number;
  peak?: number;
  alert?: string;
  updated?: string;
  restored_at?: string;
}

interface PromptInput {
  projectRoot: string;
  db: ContextDB;
}

export async function handlePrompt({ projectRoot, db }: PromptInput): Promise<void> {
  const ctxStatePath = `${projectRoot}/.claude/.ctx_state`;

  let ctxState: CtxState = {};
  let ctxAlert = 'none';
  let ctxCurrent = 0;

  if (existsSync(ctxStatePath)) {
    try {
      const raw = readFileSync(ctxStatePath, 'utf8');
      ctxState = JSON.parse(raw) as CtxState;
      ctxAlert = ctxState.alert ?? 'none';
      ctxCurrent = ctxState.current ?? 0;
    } catch {
      ctxAlert = 'none';
    }
  }

  const sessionId = db.sessionCurrent();

  if (ctxAlert === 'compacted') {
    // === 중복 복구 방지 ===
    const restoredAt = ctxState.restored_at;
    const updated = ctxState.updated;
    if (restoredAt && restoredAt === updated) {
      // 이미 복구 완료 — 기본 모드로 전환
      const newState: CtxState = {
        current: ctxCurrent,
        previous: 0,
        peak: ctxCurrent,
        alert: 'none',
        updated: new Date().toISOString(),
      };
      writeFileSync(ctxStatePath, JSON.stringify(newState));

      const sessionEdits = getSessionEdits(db, sessionId);
      const pendingTasks = getPendingCount(db);
      process.stdout.write(
        `[ctx] Session #${sessionId} | Edits: ${sessionEdits} files | Pending tasks: ${pendingTasks}\n` +
        `[rules] 한국어 · verify · agent≥3 · live-set · no-commit\n`
      );
      return;
    }

    // === 최대 복구 모드 ===
    const out: string[] = [];
    out.push('[hook:on-prompt] DB 조회: compaction 복구 (최대 모드)');
    out.push('[ctx-restore] Compaction detected. Restoring full context:');

    // live_context 전체 dump
    try {
      const liveRows = db.query(
        "SELECT '  - ' || key || ': ' || value AS line FROM live_context ORDER BY key"
      ) as Array<{ line: string }>;
      if (liveRows.length > 0) {
        for (const r of liveRows) out.push(r.line);
      } else {
        out.push('  (no live context saved)');
      }
    } catch {
      out.push('  (no live context saved)');
    }

    // 최근 decisions 5건
    try {
      const decisions = db.query(
        "SELECT '  - ' || description AS line FROM decisions ORDER BY id DESC LIMIT 5"
      ) as Array<{ line: string }>;
      if (decisions.length > 0) {
        out.push('[ctx-restore] Recent decisions:');
        for (const r of decisions) out.push(r.line);
      }
    } catch {
      // 무시
    }

    // pending tasks 상세
    try {
      const pendingCount = getPendingCount(db);
      if (pendingCount > 0) {
        const tasks = db.query(
          "SELECT '  - [P' || priority || '][' || status || '] ' || description AS line FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority"
        ) as Array<{ line: string }>;
        out.push(`[ctx-restore] Pending tasks (${pendingCount}):`);
        for (const r of tasks) out.push(r.line);
      }
    } catch {
      // 무시
    }

    // 최근 errors 3건
    try {
      const errors = db.query(
        "SELECT '  - ' || error_type || ': ' || COALESCE(file_path,'') || ' (' || timestamp || ')' AS line FROM errors ORDER BY id DESC LIMIT 3"
      ) as Array<{ line: string }>;
      if (errors.length > 0) {
        out.push('[ctx-restore] Recent errors:');
        for (const r of errors) out.push(r.line);
      }
    } catch {
      // 무시
    }

    out.push('[ctx-restore] Review above and continue your work.');

    // alert 클리어 — 직접 파일 덮어쓰기
    const restoreTs = new Date().toISOString();
    const newState: CtxState = {
      current: ctxCurrent,
      previous: 0,
      peak: ctxCurrent,
      alert: 'none',
      restored_at: restoreTs,
      updated: updated ?? restoreTs,
    };
    writeFileSync(ctxStatePath, JSON.stringify(newState));

    process.stdout.write(out.join('\n') + '\n');

  } else if (ctxAlert === 'high') {
    // === 경고 모드: 핵심 상태 자동 저장 ===
    try {
      const files = db.recentToolFiles(sessionId, 20);
      if (files.length > 0) {
        db.liveSet('working_files', files.join('\n'));
      }
    } catch {
      // 무시
    }

    process.stdout.write(
      `[ctx-warn] Context at ${ctxCurrent}%. 핵심 상태 자동 저장 완료. live-set으로 추가 저장 권장\n`
    );

  } else {
    // === 기본 모드 (최소 주입) ===
    const sessionEdits = getSessionEdits(db, sessionId);
    const pendingTasks = getPendingCount(db);

    process.stdout.write(
      `[ctx] Session #${sessionId} | Edits: ${sessionEdits} files | Pending tasks: ${pendingTasks}\n` +
      `[rules] 한국어 · verify · agent≥3 · live-set · no-commit\n`
    );
  }
}

function getSessionEdits(db: ContextDB, sessionId: number): number {
  try {
    return db.sessionEditCount(sessionId);
  } catch {
    return 0;
  }
}

function getPendingCount(db: ContextDB): number {
  try {
    return db.pendingTaskCount();
  } catch {
    return 0;
  }
}
