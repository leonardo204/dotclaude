/**
 * PostToolUse(Edit/Write) 훅 — 도구명 기록 회귀 테스트
 *
 * 배경: db.toolLog(sessionId, 'Edit', relPath)로 도구명이 하드코딩돼 있어
 * tool_usage 593행이 전부 'Edit'이었다. 바로 아래 줄이 input.tool_name === 'Write'를
 * 쓰고 있었으므로 데이터는 있었고, 저장할 때만 버려졌다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handlePostEdit } from '../src/hooks/events/post-edit.ts';
import { createFakeDB } from './helpers/fake-db.mjs';

const PROJECT_ROOT = '/Users/testuser/work/dotclaude';

/** 실측 PostToolUse 구조를 따르는 Edit/Write 페이로드. */
function makePayload(toolName, filePath) {
  return JSON.stringify({
    session_id: '0e9e6685-e540-405e-90c3-77258ea83319',
    transcript_path: `/Users/testuser/.claude/projects/x/y.jsonl`,
    cwd: PROJECT_ROOT,
    prompt_id: '76f28eba-8d73-4998-95f6-170f49f57096',
    permission_mode: 'bypassPermissions',
    effort: { level: 'high' },
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: { file_path: filePath },
    tool_use_id: 'toolu_01WmpXRfGkMZXbNK8KmC4rXB',
    duration_ms: 30,
  });
}

describe('도구명 기록 (버그 수정 증명)', () => {
  test("tool_name:'Write' → 'Write'로 저장한다 (기존에는 'Edit')", async () => {
    const db = createFakeDB({ sessionId: 7 });
    await handlePostEdit({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: makePayload('Write', `${PROJECT_ROOT}/src/new-file.ts`),
    });

    assert.equal(db.calls.toolLog.length, 1);
    assert.equal(db.calls.toolLog[0].toolName, 'Write');
    assert.equal(db.calls.toolLog[0].sessionId, 7);
  });

  test("tool_name:'Edit' → 'Edit'으로 저장한다", async () => {
    const db = createFakeDB();
    await handlePostEdit({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: makePayload('Edit', `${PROJECT_ROOT}/src/existing.ts`),
    });

    assert.equal(db.calls.toolLog[0].toolName, 'Edit');
  });

  test('다른 도구명도 그대로 보존한다 (하드코딩 아님)', async () => {
    for (const name of ['NotebookEdit', 'MultiEdit']) {
      const db = createFakeDB();
      await handlePostEdit({
        projectRoot: PROJECT_ROOT,
        db,
        stdinData: makePayload(name, `${PROJECT_ROOT}/a.ts`),
      });
      assert.equal(db.calls.toolLog[0].toolName, name);
    }
  });

  test('경로는 프로젝트 상대 경로로 변환된다', async () => {
    const db = createFakeDB();
    await handlePostEdit({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: makePayload('Write', `${PROJECT_ROOT}/src/hooks/stdin.ts`),
    });

    assert.equal(db.calls.toolLog[0].filePath, 'src/hooks/stdin.ts');
  });

  test('프로젝트 밖 경로는 절대 경로 그대로 둔다', async () => {
    const db = createFakeDB();
    await handlePostEdit({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: makePayload('Write', '/etc/somewhere/other.ts'),
    });

    assert.equal(db.calls.toolLog[0].filePath, '/etc/somewhere/other.ts');
  });
});

describe('방어 동작', () => {
  test('file_path가 없으면 기록하지 않는다', async () => {
    const db = createFakeDB();
    await handlePostEdit({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: JSON.stringify({ tool_name: 'Write', tool_input: {} }),
    });

    assert.equal(db.calls.toolLog.length, 0);
  });

  test('세션이 없으면(sessionCurrent<=0) 기록하지 않는다', async () => {
    const db = createFakeDB({ sessionId: 0 });
    await handlePostEdit({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: makePayload('Write', `${PROJECT_ROOT}/a.ts`),
    });

    assert.equal(db.calls.toolLog.length, 0);
  });

  test("tool_name이 없는 비정상 입력은 기존 동작('Edit')으로 폴백한다", async () => {
    const db = createFakeDB();
    await handlePostEdit({
      projectRoot: PROJECT_ROOT,
      db,
      stdinData: JSON.stringify({ tool_input: { file_path: `${PROJECT_ROOT}/a.ts` } }),
    });

    assert.equal(db.calls.toolLog[0].toolName, 'Edit');
  });

  test('빈 stdin / 잘못된 JSON에도 throw하지 않는다', async () => {
    const db = createFakeDB();
    await handlePostEdit({ projectRoot: PROJECT_ROOT, db, stdinData: '' });
    await handlePostEdit({ projectRoot: PROJECT_ROOT, db, stdinData: '{{bad' });

    assert.equal(db.calls.toolLog.length, 0);
  });
});
