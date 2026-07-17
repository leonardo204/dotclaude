/**
 * PostToolUseFailure 통합 테스트 — 진짜 SQLite에 진짜 행을 쓴다.
 *
 * fake DB는 "무엇을 호출했나"만 검증하므로 컬럼 오용을 잡지 못한다.
 * 레거시 셸 훅은 error_type 자리에 'Bash'를, file_path 자리에 에러 타입을 넣었다.
 * 그 회귀를 잡으려면 실제 스키마에 써 보고 읽어 봐야 한다.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextDB } from '../src/shared/db.ts';
import { handlePostBashFailure } from '../src/hooks/events/post-bash-failure.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INIT_SQL = join(__dirname, '..', 'db', 'init.sql');
const FIXTURE = join(__dirname, 'fixtures', 'post-tool-use-failure-bash.jsonl');

let dir;
let db;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ptuf-db-'));
  db = new ContextDB(join(dir, 'context.db'));
  db.initSchema(INIT_SQL);
  db.sessionCreate();
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function fixturePayload() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8').trim().split('\n')[0]);
}

describe('실제 스키마 기록', () => {
  test('실측 실패 페이로드가 errors 테이블에 의미대로 저장된다', async () => {
    const payload = fixturePayload();
    await handlePostBashFailure({
      projectRoot: dir,
      db,
      stdinData: JSON.stringify(payload),
    });

    const rows = db.errorList(10);
    assert.equal(rows.length, 1, '진짜 실패가 errors에 1행 남아야 한다');

    const [row] = rows;
    // 레거시 오용 회귀 방지: error_type은 카테고리여야 한다.
    assert.equal(row.error_type, 'runtime_error');
    assert.notEqual(row.error_type, 'Bash');
    // file_path에 에러 타입을 밀어 넣지 않는다.
    assert.equal(row.file_path, null);
    assert.equal(row.session_id, 1, '현재 세션에 연결된다');
    assert.ok(row.timestamp, 'timestamp가 채워진다');
  });

  test('error_context에 종료 코드가 남는다', () => {
    assert.match(db.liveGet('error_context'), /^runtime_error: unknown \(exit 2\)$/);
  });

  test('스키마는 그대로다 (컬럼 추가 없음)', () => {
    const cols = db
      .query("SELECT name FROM pragma_table_info('errors')")
      .map((r) => r.name);

    assert.deepEqual(cols, [
      'id',
      'session_id',
      'tool_name',
      'error_type',
      'file_path',
      'resolution',
      'timestamp',
    ]);
  });
});
