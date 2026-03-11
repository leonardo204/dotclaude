import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  SessionInfo,
  Task,
  Decision,
  ContextEntry,
  ErrorEntry,
  DBStats,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ContextDB {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
  }

  // === Init ===

  /**
   * init.sql 스키마를 실행하여 테이블을 초기화한다.
   * @param initSqlPath  init.sql의 절대 경로 (기본값: 패키지 내 db/init.sql)
   */
  initSchema(initSqlPath?: string): void {
    const sqlPath =
      initSqlPath ?? join(__dirname, '../../db/init.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    this.db.exec(sql);
  }

  // === 세션 ===

  /** 새 세션을 삽입하고 생성된 id를 반환한다. */
  sessionCreate(): number {
    const stmt = this.db.prepare(
      "INSERT INTO sessions (start_time) VALUES (datetime('now','localtime'))"
    );
    const result = stmt.run();
    return Number(result.lastInsertRowid);
  }

  /** 가장 최근 세션 id를 반환한다. */
  sessionCurrent(): number {
    const stmt = this.db.prepare(
      'SELECT id FROM sessions ORDER BY id DESC LIMIT 1'
    );
    const row = stmt.get() as { id: number } | undefined;
    return row?.id ?? 0;
  }

  /** 특정 세션 정보를 반환한다. */
  sessionInfo(id: number): SessionInfo | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    );
    return stmt.get(id) as SessionInfo | undefined;
  }

  /** 특정 세션의 필드를 부분 업데이트한다. */
  sessionUpdate(id: number, data: Partial<Omit<SessionInfo, 'id'>>): void {
    const fields = Object.keys(data) as Array<keyof typeof data>;
    if (fields.length === 0) return;

    const setClauses = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => data[f] as string | number | null);
    const stmt = this.db.prepare(
      `UPDATE sessions SET ${setClauses} WHERE id = ?`
    );
    stmt.run(...values, id);
  }

  // === Live Context ===

  /** live_context에 key-value를 설정(upsert)한다. */
  liveSet(key: string, value: string): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))"
    );
    stmt.run(key, value);
  }

  /** live_context에서 key로 값을 조회한다. */
  liveGet(key: string): string | null {
    const stmt = this.db.prepare(
      'SELECT value FROM live_context WHERE key = ?'
    );
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * live_context의 key에 value를 줄 단위로 추가한다.
   * 중복 줄은 건너뛰고 maxLines 초과분은 오래된 줄부터 제거한다.
   */
  liveAppend(key: string, value: string, maxLines = 20): void {
    const existing = this.liveGet(key);
    if (existing !== null) {
      const lines = existing.split('\n');
      // 중복 확인 (grep -Fxq 동등)
      if (lines.includes(value)) {
        return;
      }
      // 추가 후 최근 maxLines개 유지
      const updated = [...lines, value].slice(-maxLines).join('\n');
      this.liveSet(key, updated);
    } else {
      this.liveSet(key, value);
    }
  }

  /** live_context 전체를 { key: value } 형태로 반환한다. */
  liveDump(): Record<string, string> {
    const stmt = this.db.prepare(
      'SELECT key, value FROM live_context ORDER BY key'
    );
    const rows = stmt.all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** live_context에서 key를 삭제한다. */
  liveClear(): void {
    this.db.exec('DELETE FROM live_context');
  }

  // === Context (key-value store) ===

  ctxGet(key: string): string | null {
    const stmt = this.db.prepare(
      'SELECT value FROM context WHERE key = ? ORDER BY updated_at DESC LIMIT 1'
    );
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  ctxSet(key: string, value: string, category = 'general'): void {
    const stmt = this.db.prepare(
      'INSERT INTO context (key, value, category) VALUES (?, ?, ?)'
    );
    stmt.run(key, value, category);
  }

  ctxList(category?: string): ContextEntry[] {
    if (category) {
      const stmt = this.db.prepare(
        'SELECT * FROM context WHERE category = ? ORDER BY updated_at DESC'
      );
      return stmt.all(category) as unknown as ContextEntry[];
    }
    const stmt = this.db.prepare(
      'SELECT * FROM context ORDER BY updated_at DESC'
    );
    return stmt.all() as unknown as ContextEntry[];
  }

  // === Tasks ===

  /** 태스크를 추가하고 생성된 id를 반환한다. */
  taskAdd(description: string, priority = 3, category = ''): number {
    const stmt = this.db.prepare(
      'INSERT INTO tasks (description, priority, category) VALUES (?, ?, ?)'
    );
    const result = stmt.run(description, priority, category);
    return Number(result.lastInsertRowid);
  }

  /** 태스크 목록을 조회한다. status 미지정 시 'pending'. */
  taskList(status?: string): Task[] {
    const s = status ?? 'pending';
    if (s === 'all') {
      const stmt = this.db.prepare(
        'SELECT * FROM tasks ORDER BY priority, created_at'
      );
      return stmt.all() as unknown as Task[];
    }
    const stmt = this.db.prepare(
      "SELECT * FROM tasks WHERE status = ? ORDER BY priority, created_at"
    );
    return stmt.all(s) as unknown as Task[];
  }

  /** 태스크를 완료 처리한다. */
  taskDone(id: number): void {
    const stmt = this.db.prepare(
      "UPDATE tasks SET status='done', completed_at=datetime('now','localtime') WHERE id = ?"
    );
    stmt.run(id);
  }

  /** 태스크 상태를 임의 값으로 업데이트한다. */
  taskUpdate(id: number, status: string): void {
    const stmt = this.db.prepare(
      'UPDATE tasks SET status = ? WHERE id = ?'
    );
    stmt.run(status, id);
  }

  // === Decisions ===

  /** 결정을 기록하고 생성된 id를 반환한다. */
  decisionAdd(
    description: string,
    rationale?: string,
    relatedFiles?: string
  ): number {
    const stmt = this.db.prepare(
      'INSERT INTO decisions (description, reason, related_files) VALUES (?, ?, ?)'
    );
    const result = stmt.run(description, rationale ?? null, relatedFiles ?? null);
    return Number(result.lastInsertRowid);
  }

  /** 최근 결정 목록을 반환한다. */
  decisionList(limit = 10): Decision[] {
    const stmt = this.db.prepare(
      'SELECT * FROM decisions ORDER BY id DESC LIMIT ?'
    );
    return stmt.all(limit) as unknown as Decision[];
  }

  // === Errors ===

  /** 에러를 현재 세션에 기록한다. */
  errorLog(
    errorType: string,
    filePath?: string,
    resolution?: string
  ): void {
    const sessionId = this.sessionCurrent();
    const stmt = this.db.prepare(
      'INSERT INTO errors (session_id, error_type, file_path, resolution) VALUES (?, ?, ?, ?)'
    );
    stmt.run(sessionId || null, errorType, filePath ?? null, resolution ?? null);
  }

  /** 최근 에러 목록을 반환한다. */
  errorList(limit = 10): ErrorEntry[] {
    const stmt = this.db.prepare(
      'SELECT * FROM errors ORDER BY id DESC LIMIT ?'
    );
    return stmt.all(limit) as unknown as ErrorEntry[];
  }

  // === Commits ===

  commitLog(hash: string, message: string, filesJson?: string): void {
    const sessionId = this.sessionCurrent();
    const stmt = this.db.prepare(
      'INSERT INTO commits (session_id, hash, message, files_changed) VALUES (?, ?, ?, ?)'
    );
    stmt.run(sessionId || null, hash, message, filesJson ?? null);
  }

  // === Tool Usage ===

  /** 도구 사용 내역을 기록한다. */
  toolLog(sessionId: number, toolName: string, filePath: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO tool_usage (session_id, tool_name, file_path) VALUES (?, ?, ?)'
    );
    stmt.run(sessionId, toolName, filePath);
  }

  // === Agent Handoff ===

  /**
   * agent-task / agent-result / agent-context 에 해당.
   * prefix: '_task:', '_result:', '_ctx:'
   */
  agentTask(name: string, description: string): void {
    this.liveSet(`_task:${name}`, description);
  }

  agentTaskGet(name: string): string | null {
    return this.liveGet(`_task:${name}`);
  }

  agentResult(name: string, result: string): void {
    this.liveSet(`_result:${name}`, result);
  }

  agentResultGet(name: string): string | null {
    return this.liveGet(`_result:${name}`);
  }

  /**
   * agent-context: value가 있으면 설정, 없으면 조회.
   * helper.sh와 동일한 read/write 이중 동작을 TS API로는 두 메서드로 분리한다.
   */
  agentContext(key: string, value?: string): string | null {
    if (value !== undefined) {
      this.liveSet(`_ctx:${key}`, value);
      return null;
    }
    return this.liveGet(`_ctx:${key}`);
  }

  agentCleanup(name: string): void {
    const stmt = this.db.prepare(
      "DELETE FROM live_context WHERE key = ? OR key = ?"
    );
    stmt.run(`_task:${name}`, `_result:${name}`);
  }

  // === Stats ===

  stats(): DBStats {
    const count = (sql: string): number => {
      const stmt = this.db.prepare(sql);
      const row = stmt.get() as { n: number };
      return row?.n ?? 0;
    };

    return {
      sessions: count('SELECT COUNT(*) AS n FROM sessions'),
      tasks: count("SELECT COUNT(*) AS n FROM tasks WHERE status='pending'"),
      decisions: count('SELECT COUNT(*) AS n FROM decisions'),
      errors: count('SELECT COUNT(*) AS n FROM errors'),
      tool_usage: count('SELECT COUNT(*) AS n FROM tool_usage'),
      live_context: count('SELECT COUNT(*) AS n FROM live_context'),
    };
  }

  // === Raw Query ===

  query(sql: string): unknown[] {
    const stmt = this.db.prepare(sql);
    return stmt.all();
  }

  /** private db 인스턴스에 exec을 직접 호출한다. */
  execRaw(sql: string): void {
    this.db.exec(sql);
  }

  // === 전용 헬퍼 메서드 ===

  /** 특정 세션에서 편집된 고유 파일 수를 반환한다. */
  sessionEditCount(sessionId: number): number {
    const stmt = this.db.prepare(
      'SELECT COUNT(DISTINCT file_path) AS n FROM tool_usage WHERE session_id = ?'
    );
    const row = stmt.get(sessionId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** pending/in_progress 태스크 수를 반환한다. */
  pendingTaskCount(): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('pending','in_progress')"
    );
    const row = stmt.get() as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** 특정 세션에서 최근 편집된 파일 경로 목록을 반환한다. */
  recentToolFiles(sessionId: number, limit = 10): string[] {
    const stmt = this.db.prepare(
      'SELECT DISTINCT file_path FROM tool_usage WHERE session_id = ? ORDER BY id DESC LIMIT ?'
    );
    const rows = stmt.all(sessionId, limit) as Array<{ file_path: string }>;
    return rows.map((r) => r.file_path);
  }

  // === Lifecycle ===

  close(): void {
    this.db.close();
  }
}
