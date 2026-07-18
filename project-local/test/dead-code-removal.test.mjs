/**
 * 죽은 코드 제거 회귀 테스트.
 *
 * 배경: tasks/context/prompts/context_fts 테이블과 그 reader/writer 를 제거했다.
 * (네이티브 TodoWrite/auto-memory 가 대체 — write 경로가 죽어 read 가 항상 0/빈값).
 * 이 테스트는 (1) 새 스키마에 죽은 테이블이 없고, (2) 각 훅이 죽은 테이블 없이도
 * 예외 없이 정상 출력하며, (3) 구 DB 마이그레이션이 데이터 손실 없이 제거하고,
 * (4) 살아있는 helper 서브커맨드가 계속 동작함을 고정한다.
 *
 * 뮤테이션 방어: 제거를 되돌리면(테이블/쿼리 부활) 여기 단언들이 깨진다.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ContextDB } from '../src/shared/db.ts';
import { handleSessionStart } from '../src/hooks/events/session-start.ts';
import { handlePrompt } from '../src/hooks/events/prompt.ts';
import { handleStopSession } from '../src/hooks/events/stop-session.ts';
import { captureStdout, captureStderr } from './helpers/fake-db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INIT_SQL = join(__dirname, '..', 'db', 'init.sql');
const HELPER_SH = join(__dirname, '..', 'db', 'helper.sh');

const DEAD_TABLES = ['tasks', 'context', 'prompts', 'context_fts'];
const LIVE_TABLES = [
  'sessions',
  'tool_usage',
  'commits',
  'decisions',
  'errors',
  'live_context',
  'db_meta',
];

/** DB 안의 테이블/가상테이블 이름 집합을 반환한다. */
function tableNames(db) {
  const rows = db.query(
    "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
  );
  return new Set(rows.map((r) => r.name));
}

describe('init.sql 스키마 — 죽은 테이블 부재', () => {
  let dir;
  let db;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dead-init-'));
    db = new ContextDB(join(dir, 'context.db'));
    db.initSchema(INIT_SQL);
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('tasks/context/prompts/context_fts 가 존재하지 않는다', () => {
    const names = tableNames(db);
    for (const t of DEAD_TABLES) {
      assert.equal(names.has(t), false, `죽은 테이블 '${t}' 이 남아 있으면 안 된다`);
    }
  });

  test('살아있는 테이블은 모두 존재한다', () => {
    const names = tableNames(db);
    for (const t of LIVE_TABLES) {
      assert.equal(names.has(t), true, `살아있는 테이블 '${t}' 이 있어야 한다`);
    }
  });

  test('schema_version 이 1.3 이다', () => {
    const [row] = db.query("SELECT value FROM db_meta WHERE key='schema_version'");
    assert.equal(row.value, '1.3');
  });

  test('stats() 에 tasks 카운트가 없다', () => {
    const s = db.stats();
    assert.equal('tasks' in s, false, 'DBStats 에 tasks 필드가 남아 있으면 안 된다');
    assert.equal(typeof s.sessions, 'number');
    assert.equal(typeof s.decisions, 'number');
  });
});

describe('훅 동작 — 죽은 테이블 없이 예외 없이 정상 출력', () => {
  let dir;
  let db;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dead-hooks-'));
    mkdirSync(join(dir, '.claude'), { recursive: true });
    db = new ContextDB(join(dir, 'context.db'));
    db.initSchema(INIT_SQL);
    db.sessionCreate();
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('session-start: 예외 없이 checkin 을 출력하고 tasks/context 주입이 없다', async () => {
    let out = '';
    await assert.doesNotReject(async () => {
      out = await captureStdout(() => handleSessionStart({ projectRoot: dir, db }));
    });
    assert.match(out, /\[checkin\] Session #\d+ started/);
    assert.equal(/Pending tasks:/.test(out), false, 'pending tasks 주입이 제거돼야 한다');
    assert.equal(/context 인덱스/.test(out), false, 'context 인덱스 주입이 제거돼야 한다');
  });

  test('prompt: 기본 모드에서 Pending tasks 없이 ctx 줄을 출력한다', async () => {
    let out = '';
    await assert.doesNotReject(async () => {
      out = await captureStdout(() => handlePrompt({ projectRoot: dir, db }));
    });
    assert.match(out, /\[ctx\] Session #\d+ \| Edits: \d+ files/);
    assert.equal(/Pending tasks:/.test(out), false, 'ctx 줄에서 Pending tasks 가 제거돼야 한다');
  });

  test('stop-session: handoff 를 tasks 없이 생성한다', async () => {
    // handoff 에 내용이 생기도록 결정/도구사용을 심는다 (tasks 없이도 생성돼야 함).
    const sid = db.sessionCurrent();
    db.toolLog(sid, 'Edit', join(dir, 'a.ts'));
    db.decisionAdd('테스트 결정', '이유');

    let outText = '';
    const errText = await captureStderr(async () => {
      outText = await captureStdout(() => handleStopSession({ db }));
    });

    assert.equal(outText, '', 'Stop stdout 은 JSON 전용 — 비어 있어야 한다');
    assert.match(errText, /\[hook:on-stop\] DB 조회/);

    const handoff = db.liveGet('session_handoff');
    assert.ok(handoff, 'handoff 가 저장돼야 한다');
    assert.match(handoff, /직전 세션 #/);
    assert.equal(/미완료 태스크/.test(handoff), false, 'handoff 에 미완료 태스크 섹션이 없어야 한다');
  });
});

describe('helper.sh — 살아있는 서브커맨드 (새 스키마)', () => {
  let dir;
  let helper;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dead-helper-'));
    const dbDir = join(dir, '.claude', 'db');
    mkdirSync(dbDir, { recursive: true });
    copyFileSync(HELPER_SH, join(dbDir, 'helper.sh'));
    copyFileSync(INIT_SQL, join(dbDir, 'init.sql'));
    helper = join(dbDir, 'helper.sh');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (...args) =>
    execFileSync('bash', [helper, ...args], { encoding: 'utf8' });

  test('live-set / live-get 이 동작한다 (DB 자동 초기화 포함)', () => {
    run('live-set', 'k1', 'v1');
    assert.equal(run('live-get', 'k1').trim(), 'v1');
  });

  test('decision-add 가 동작한다', () => {
    const out = run('decision-add', '결정A', '이유A');
    assert.match(out, /Decision recorded/);
  });

  test('stats 가 tasks/context 줄 없이 동작한다', () => {
    const out = run('stats');
    assert.match(out, /Sessions:/);
    assert.match(out, /Decisions:/);
    assert.equal(/Tasks \(pending\):/.test(out), false, 'stats 에서 tasks 줄이 제거돼야 한다');
    assert.equal(/Context entries:/.test(out), false, 'stats 에서 context 줄이 제거돼야 한다');
  });

  test('새 DB 에 죽은 테이블이 없다 (helper 초기화 경로)', () => {
    const names = run(
      'query',
      "SELECT group_concat(name) FROM sqlite_master WHERE type='table'"
    );
    for (const t of DEAD_TABLES) {
      assert.equal(new RegExp(`\\b${t}\\b`).test(names), false, `'${t}' 이 없어야 한다`);
    }
  });

  test('제거된 서브커맨드는 크래시 없이 Usage 로 처리된다', () => {
    for (const cmd of ['task-add', 'task-list', 'ctx-get', 'ctx-set', 'agent-list']) {
      const out = run(cmd, 'x', 'y');
      assert.match(out, /Usage: helper\.sh/, `'${cmd}' 는 Usage 로 폴백돼야 한다`);
    }
  });
});

describe('마이그레이션 — 구 DB(1.2) 에서 죽은 테이블 안전 제거', () => {
  let dir;
  let helper;
  let dbPath;

  const OLD_SCHEMA = `
    CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, start_time TEXT);
    CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT, reason TEXT, related_files TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE tool_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, tool_name TEXT, file_path TEXT, timestamp TEXT);
    CREATE TABLE errors (id INTEGER PRIMARY KEY AUTOINCREMENT, error_type TEXT);
    CREATE TABLE commits (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT, message TEXT);
    CREATE TABLE live_context (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT, priority INTEGER, status TEXT, category TEXT, created_at TEXT, completed_at TEXT);
    CREATE TABLE context (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, value TEXT, category TEXT, created_at TEXT, updated_at TEXT, last_access_ts TEXT, access_count INTEGER DEFAULT 0);
    CREATE TABLE prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, content_hash TEXT, keyword_tags TEXT, timestamp TEXT);
    CREATE VIRTUAL TABLE context_fts USING fts5(key, value, content='context', content_rowid='id');
    CREATE TABLE db_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO db_meta (key, value) VALUES ('schema_version', '1.2');
  `;

  function names() {
    const out = execFileSync(
      'sqlite3',
      [dbPath, "SELECT group_concat(name) FROM sqlite_master WHERE type='table'"],
      { encoding: 'utf8' }
    );
    return out;
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dead-migrate-'));
    const dbDir = join(dir, '.claude', 'db');
    mkdirSync(dbDir, { recursive: true });
    copyFileSync(HELPER_SH, join(dbDir, 'helper.sh'));
    copyFileSync(INIT_SQL, join(dbDir, 'init.sql'));
    helper = join(dbDir, 'helper.sh');
    dbPath = join(dbDir, 'context.db');

    // 구 스키마 + 살아있는 데이터 + 빈 죽은 테이블(가드로 DROP 가능) 준비.
    execFileSync('sqlite3', [dbPath], { input: OLD_SCHEMA, encoding: 'utf8' });
    execFileSync('sqlite3', [dbPath, "INSERT INTO decisions (description) VALUES ('보존될 결정');"], { encoding: 'utf8' });
    execFileSync('sqlite3', [dbPath, "INSERT INTO live_context (key, value) VALUES ('keep', 'me');"], { encoding: 'utf8' });
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('마이그레이션 후 죽은 테이블이 제거되고 살아있는 데이터가 보존된다', () => {
    // 아무 명령이나 실행하면 상단 마이그레이션 블록이 1회 수행된다.
    execFileSync('bash', [helper, 'stats'], { encoding: 'utf8' });

    const t = names();
    for (const dead of DEAD_TABLES) {
      assert.equal(new RegExp(`\\b${dead}\\b`).test(t), false, `'${dead}' 이 제거돼야 한다`);
    }
    for (const live of LIVE_TABLES) {
      assert.equal(new RegExp(`\\b${live}\\b`).test(t), true, `'${live}' 이 보존돼야 한다`);
    }

    // 데이터 보존 확인.
    const dec = execFileSync('sqlite3', [dbPath, 'SELECT description FROM decisions;'], { encoding: 'utf8' });
    assert.match(dec, /보존될 결정/);
    const lc = execFileSync('sqlite3', [dbPath, "SELECT value FROM live_context WHERE key='keep';"], { encoding: 'utf8' });
    assert.match(lc, /me/);

    // schema_version 갱신.
    const ver = execFileSync('sqlite3', [dbPath, "SELECT value FROM db_meta WHERE key='schema_version';"], { encoding: 'utf8' });
    assert.equal(ver.trim(), '1.3');
  });

  test('행이 있는 tasks 는 가드로 보존된다 (데이터 손실 방지)', () => {
    // 별도 DB: tasks 에 행이 있으면 DROP 하지 않는다.
    const dir2 = mkdtempSync(join(tmpdir(), 'dead-guard-'));
    const dbDir2 = join(dir2, '.claude', 'db');
    mkdirSync(dbDir2, { recursive: true });
    copyFileSync(HELPER_SH, join(dbDir2, 'helper.sh'));
    copyFileSync(INIT_SQL, join(dbDir2, 'init.sql'));
    const helper2 = join(dbDir2, 'helper.sh');
    const dbPath2 = join(dbDir2, 'context.db');

    execFileSync('sqlite3', [dbPath2], { input: OLD_SCHEMA, encoding: 'utf8' });
    execFileSync('sqlite3', [dbPath2, "INSERT INTO tasks (description, status) VALUES ('중요 미완료', 'pending');"], { encoding: 'utf8' });

    execFileSync('bash', [helper2, 'stats'], { encoding: 'utf8' });

    const t = execFileSync('sqlite3', [dbPath2, "SELECT group_concat(name) FROM sqlite_master WHERE type='table'"], { encoding: 'utf8' });
    assert.match(t, /\btasks\b/, '행이 있는 tasks 는 가드로 보존돼야 한다');
    // prompts/context_fts 는 무조건 제거된다.
    assert.equal(/\bprompts\b/.test(t), false, 'prompts 는 무조건 제거');
    assert.equal(/\bcontext_fts\b/.test(t), false, 'context_fts 는 무조건 제거');

    rmSync(dir2, { recursive: true, force: true });
  });
});
