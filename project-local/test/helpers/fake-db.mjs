/**
 * ContextDB 테스트 대역(fake).
 *
 * 훅 핸들러는 DB 인스턴스를 주입받으므로, 실제 SQLite 없이도
 * "무엇을 어떤 인자로 저장했는가"를 그대로 검증할 수 있다.
 * 호출 내역을 calls 배열에 기록한다.
 */
export function createFakeDB(overrides = {}) {
  const calls = {
    errorLog: [],
    liveSet: [],
    toolLog: [],
    sessionUpdate: [],
    query: [],
  };

  const db = {
    calls,

    // === post-bash가 사용 ===
    errorLog(errorType, filePath, resolution) {
      calls.errorLog.push({ errorType, filePath, resolution });
    },
    liveSet(key, value) {
      calls.liveSet.push({ key, value });
    },

    // === post-edit가 사용 ===
    sessionCurrent() {
      return overrides.sessionId ?? 1;
    },
    toolLog(sessionId, toolName, filePath) {
      calls.toolLog.push({ sessionId, toolName, filePath });
    },

    // === stop-session이 사용 ===
    sessionEditCount() {
      return overrides.editCount ?? 0;
    },
    sessionInfo() {
      return overrides.sessionInfo ?? null;
    },
    sessionUpdate(id, data) {
      calls.sessionUpdate.push({ id, data });
    },
    recentToolFiles() {
      return overrides.recentFiles ?? [];
    },
    query(sql) {
      calls.query.push(sql);
      return [];
    },
    close() {},
  };

  return db;
}

/**
 * process.stdout.write를 가로채 훅의 stdout 출력을 수집한다.
 * 훅 핸들러는 async이므로 반드시 await 완료 후 복원한다.
 */
export async function captureStdout(fn) {
  const original = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

export async function captureStderr(fn) {
  const original = process.stderr.write;
  let captured = '';
  process.stderr.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}
