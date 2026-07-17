/**
 * apply-manifest.mjs 통합 테스트 — 실제 파일시스템 시뮬레이션
 *
 * manifest 기반 배포 + 버저닝 skip 의 검증. install/update/uninstall 이 전부
 * 이 스크립트를 호출하므로 여기가 배포 계약의 단일 검증 지점이다.
 *
 * 커버리지:
 *  - 최초 apply(복사 + 스탬프 + resolved manifest 배치)
 *  - skip (동일 SHA 재실행 시 파일 mtime 불변)
 *  - SHA 변경 시 재적용
 *  - --force 강제 재적용
 *  - required/sentinel hard-fail
 *  - 오버레이 비파괴
 *  - merge-hooks (사용자 키 보존 + statusLine 조건)
 *  - replace-if-unmodified (미수정 교체 / 수정 보존)
 *  - uninstall (harness+runtime 삭제, 미선언 보존)
 *  - 원자성 (required fail → 스탬프 미기록 → 다음 apply 재실행)
 *  - 뮤테이션 (스탬프를 복사 前에 쓰면 원자성 테스트가 깨지는지 자가검증)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  statSync, rmSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
// project-local/test → repo 루트 bin/apply-manifest.mjs
const APPLY = join(__dirname, '..', '..', 'bin', 'apply-manifest.mjs');

// ─── 헬퍼 ───
function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** apply-manifest 실행. {stdout, stderr, code} 반환. throw 하지 않음. */
function run(argv) {
  try {
    const stdout = execFileSync('node', [APPLY, ...argv], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (e) {
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      code: e.status ?? 1,
    };
  }
}

/** stdout 마지막 JSON 라인 파싱. */
function parseResult(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

/** 최소 SRC 픽스처 (repo 구조 모사). manifest.json + 파일들. */
function makeSrc() {
  const src = mkdtempSync(join(tmpdir(), 'dc-src-'));
  const manifest = {
    manifestVersion: 1,
    entries: [
      { id: 'global-settings', scope: 'global', src: 'global/settings.json', dest: 'settings.json', policy: 'merge-hooks', ownership: 'harness' },
      { id: 'global-claude-md', scope: 'global', src: 'global/CLAUDE.md', dest: 'CLAUDE.md', policy: 'replace-if-unmodified', ownership: 'harness' },
      { id: 'global-scripts', scope: 'global', src: 'global/scripts/', dest: 'scripts/', recursive: true, policy: 'replace', ownership: 'harness' },
      { id: 'global-bin', scope: 'global', src: 'bin/', dest: 'bin/', recursive: true, policy: 'replace', ownership: 'harness', required: true, sentinels: ['apply-manifest.mjs'] },
      { id: 'dist', scope: 'both', src: 'project-local/dist/', dest: 'dist/', recursive: true, policy: 'replace', ownership: 'harness', required: true, sentinels: ['hooks/bridge.js', 'hud/statusline.js', 'messenger/cli.js'] },
      { id: 'local-agents', scope: 'local', src: 'project-local/agents/', dest: 'agents/', recursive: true, policy: 'replace', ownership: 'harness' },
    ],
    runtime_artifacts: [
      { path: 'messenger.json', scope: 'global' },
      { path: '.dotclaude-manifest.json', scope: 'global' },
    ],
  };
  write(join(src, 'manifest.json'), JSON.stringify(manifest, null, 2));
  write(join(src, 'VERSION'), '0.2.0\n');

  // global 파일
  write(join(src, 'global', 'settings.json'), JSON.stringify({
    statusLine: { type: 'command', command: 'hud' },
    hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'v1' }] }] },
  }, null, 2) + '\n');
  write(join(src, 'global', 'CLAUDE.md'), '# Global CLAUDE v1\n');
  write(join(src, 'global', 'scripts', 'messenger.sh'), '#!/usr/bin/env bash\necho v1\n');
  write(join(src, 'bin', 'apply-manifest.mjs'), '// placeholder cli\n');

  // dist (recursive, sentinels)
  write(join(src, 'project-local', 'dist', 'hooks', 'bridge.js'), 'bridge v1\n');
  write(join(src, 'project-local', 'dist', 'hud', 'statusline.js'), 'statusline v1\n');
  write(join(src, 'project-local', 'dist', 'hud', 'fetcher.js'), 'fetcher v1\n');
  write(join(src, 'project-local', 'dist', 'messenger', 'cli.js'), 'messenger v1\n');

  // local
  write(join(src, 'project-local', 'agents', 'ralph.md'), 'ralph v1\n');

  return src;
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────
describe('apply-manifest: 최초 apply', () => {
  test('global entries 복사 + 스탬프 + resolved manifest 배치', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      const r = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(r.code, 0, r.stderr);
      const res = parseResult(r.stdout);
      assert.equal(res.scope, 'global');
      assert.ok(res.applied.includes('global-settings'));
      assert.ok(res.applied.includes('dist'));
      // local-agents 는 global scope 에서 제외
      assert.ok(!res.applied.includes('local-agents'));

      // 실제 파일 복사 확인
      assert.ok(existsSync(join(dest, 'settings.json')));
      assert.ok(existsSync(join(dest, 'CLAUDE.md')));
      assert.ok(existsSync(join(dest, 'scripts', 'messenger.sh')));
      assert.ok(existsSync(join(dest, 'bin', 'apply-manifest.mjs')));
      assert.ok(existsSync(join(dest, 'dist', 'messenger', 'cli.js')));

      // 스탬프 (.dotclaude-installed applied_sha)
      const stamp = readFileSync(join(dest, '.dotclaude-installed'), 'utf8');
      assert.match(stamp, /applied_sha=/);
      assert.match(stamp, /version=0\.2\.0/);
      assert.equal(stamp.includes('version=1.0.0'), false);

      // resolved manifest 배치 + deployed_sha256 기록
      const rm = JSON.parse(readFileSync(join(dest, '.dotclaude-manifest.json'), 'utf8'));
      const claudeEntry = rm.entries.find((e) => e.id === 'global-claude-md');
      assert.ok(claudeEntry.deployed_sha256, 'deployed_sha256 기록되어야 함');
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: skip (테스트 3)', () => {
  test('동일 SRC 재실행 → skipped:true, 파일 mtime 불변', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      const first = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(first.code, 0, first.stderr);
      const target = join(dest, 'dist', 'messenger', 'cli.js');
      const mtime1 = statSync(target).mtimeMs;

      const second = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(second.code, 0, second.stderr);
      const res = parseResult(second.stdout);
      assert.equal(res.skipped, true);
      assert.equal(res.reason, 'up-to-date');

      const mtime2 = statSync(target).mtimeMs;
      assert.equal(mtime2, mtime1, 'skip 시 파일이 다시 쓰이면 안 됨');
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: SHA 변경 시 재적용 (테스트 4)', () => {
  test('SRC 내용(VERSION) 변경 → 폴백해시 달라짐 → 재적용', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      const first = run(['--scope', 'global', '--src', src, '--dest', dest]);
      const sha1 = parseResult(first.stdout).sha;

      // VERSION 변경 → 폴백 해시 변화
      writeFileSync(join(src, 'VERSION'), '0.3.0\n');
      const second = run(['--scope', 'global', '--src', src, '--dest', dest]);
      const res = parseResult(second.stdout);
      assert.notEqual(res.sha, sha1, 'SHA 가 변해야 함');
      assert.notEqual(res.skipped, true, 'skip 되면 안 됨');
      assert.ok(res.applied.includes('dist'));
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: --force (테스트 5)', () => {
  test('skip 상태에서 --force → 강제 재적용', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      run(['--scope', 'global', '--src', src, '--dest', dest]);
      const forced = run(['--scope', 'global', '--src', src, '--dest', dest, '--force']);
      const res = parseResult(forced.stdout);
      assert.notEqual(res.skipped, true);
      assert.ok(res.applied.includes('dist'));
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: required/sentinel hard-fail (테스트 6)', () => {
  test('dist src 비우면 exit 1', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      // dist 디렉토리 비우기 (빌드 누락 시뮬레이션)
      rmSync(join(src, 'project-local', 'dist'), { recursive: true, force: true });
      mkdirSync(join(src, 'project-local', 'dist'), { recursive: true });
      const r = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(r.code, 1, 'required 빈 디렉토리는 hard-fail');
      assert.match(r.stderr, /required|sentinel/i);
    } finally {
      cleanup(src, dest);
    }
  });

  test('sentinel 파일 누락(dist 있으나 messenger 없음) → exit 1', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      rmSync(join(src, 'project-local', 'dist', 'messenger'), { recursive: true, force: true });
      const r = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /sentinel/i);
      // 원자성: sentinel fail → 스탬프 미기록
      assert.equal(existsSync(join(dest, '.dotclaude-installed')), false);
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: 오버레이 비파괴 (테스트 7)', () => {
  test('DEST/agents 커스텀 파일 보존 + harness 파일 갱신', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      // 로컬 스코프로 agents 배포. 사전에 커스텀 파일 배치.
      write(join(dest, 'agents', 'my-custom.md'), 'custom agent\n');
      const r = run(['--scope', 'local', '--src', src, '--dest', dest]);
      assert.equal(r.code, 0, r.stderr);
      // 커스텀 보존
      assert.ok(existsSync(join(dest, 'agents', 'my-custom.md')));
      assert.equal(readFileSync(join(dest, 'agents', 'my-custom.md'), 'utf8'), 'custom agent\n');
      // harness 파일 배포
      assert.equal(readFileSync(join(dest, 'agents', 'ralph.md'), 'utf8'), 'ralph v1\n');
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: merge-hooks (테스트 8)', () => {
  test('사용자 키 보존 + hooks 교체 + statusLine 조건', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      // 기존 settings.json: 사용자 키 + 이미 존재하는 statusLine + 구버전 hooks
      write(join(dest, 'settings.json'), JSON.stringify({
        enabledPlugins: { foo: true },
        permissions: { allow: ['Bash'] },
        statusLine: { type: 'command', command: 'user-custom-hud' },
        hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'OLD' }] }] },
      }, null, 2));

      const r = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(r.code, 0, r.stderr);
      const s = JSON.parse(readFileSync(join(dest, 'settings.json'), 'utf8'));
      // 사용자 키 보존
      assert.deepEqual(s.enabledPlugins, { foo: true });
      assert.deepEqual(s.permissions, { allow: ['Bash'] });
      // hooks 는 repo 최신으로 교체
      assert.equal(s.hooks.SessionStart[0].hooks[0].command, 'v1');
      // statusLine: 사용자가 이미 가지고 있으면 덮어쓰지 않음
      assert.equal(s.statusLine.command, 'user-custom-hud');
    } finally {
      cleanup(src, dest);
    }
  });

  test('statusLine 없고 .hud_disabled 있으면 statusLine 미추가', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      write(join(dest, 'settings.json'), JSON.stringify({ hooks: {} }, null, 2));
      write(join(dest, '.hud_disabled'), '');
      run(['--scope', 'global', '--src', src, '--dest', dest]);
      const s = JSON.parse(readFileSync(join(dest, 'settings.json'), 'utf8'));
      assert.equal(s.statusLine, undefined, '.hud_disabled 면 statusLine 미추가');
    } finally {
      cleanup(src, dest);
    }
  });

  test('statusLine 없고 .hud_disabled 없으면 statusLine 추가', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      write(join(dest, 'settings.json'), JSON.stringify({ hooks: {} }, null, 2));
      run(['--scope', 'global', '--src', src, '--dest', dest]);
      const s = JSON.parse(readFileSync(join(dest, 'settings.json'), 'utf8'));
      assert.equal(s.statusLine.command, 'hud');
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: replace-if-unmodified (테스트 9)', () => {
  test('미수정 시 교체 / 수정 시 보존', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      // 1차 설치
      run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(readFileSync(join(dest, 'CLAUDE.md'), 'utf8'), '# Global CLAUDE v1\n');

      // repo CLAUDE.md 업데이트 + VERSION 변경(재적용 트리거)
      writeFileSync(join(src, 'global', 'CLAUDE.md'), '# Global CLAUDE v2\n');
      writeFileSync(join(src, 'VERSION'), '0.3.0\n');

      // (a) 사용자 미수정 → 교체
      const r2 = run(['--scope', 'global', '--src', src, '--dest', dest]);
      const res2 = parseResult(r2.stdout);
      assert.ok(res2.applied.includes('global-claude-md'));
      assert.equal(readFileSync(join(dest, 'CLAUDE.md'), 'utf8'), '# Global CLAUDE v2\n');

      // (b) 사용자 수정 후 → 보존
      writeFileSync(join(dest, 'CLAUDE.md'), '# USER EDITED\n');
      writeFileSync(join(src, 'global', 'CLAUDE.md'), '# Global CLAUDE v3\n');
      writeFileSync(join(src, 'VERSION'), '0.4.0\n');
      const r3 = run(['--scope', 'global', '--src', src, '--dest', dest]);
      const res3 = parseResult(r3.stdout);
      assert.ok(res3.preserved.includes('global-claude-md'), 'user 수정 → preserved');
      assert.equal(readFileSync(join(dest, 'CLAUDE.md'), 'utf8'), '# USER EDITED\n');
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: uninstall (테스트 10)', () => {
  test('harness+runtime 삭제, 미선언 파일 잔존', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      run(['--scope', 'global', '--src', src, '--dest', dest]);
      // 미선언 사용자 파일 + runtime 파일 배치
      write(join(dest, 'my-notes.md'), 'keep me\n');
      write(join(dest, 'messenger.json'), '{"token":"x"}\n');

      const installedManifest = join(dest, '.dotclaude-manifest.json');
      const r = run(['--uninstall', '--dest', dest, '--manifest', installedManifest]);
      assert.equal(r.code, 0, r.stderr);

      // harness dest 삭제
      assert.equal(existsSync(join(dest, 'dist')), false);
      assert.equal(existsSync(join(dest, 'CLAUDE.md')), false);
      assert.equal(existsSync(join(dest, 'scripts')), false);
      // runtime 삭제
      assert.equal(existsSync(join(dest, 'messenger.json')), false);
      // 미선언 사용자 파일 잔존
      assert.ok(existsSync(join(dest, 'my-notes.md')));
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: 원자성 (테스트 11)', () => {
  test('required fail → 스탬프 미기록 → 복구 후 다음 apply 재적용', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      // dist sentinel 파괴 → fail
      rmSync(join(src, 'project-local', 'dist', 'messenger'), { recursive: true, force: true });
      const fail = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(fail.code, 1);
      // 스탬프 미기록
      assert.equal(existsSync(join(dest, '.dotclaude-installed')), false);

      // 복구 후 재실행 → 정상 적용 (skip 되지 않음)
      write(join(src, 'project-local', 'dist', 'messenger', 'cli.js'), 'messenger v1\n');
      const ok = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(ok.code, 0, ok.stderr);
      const res = parseResult(ok.stdout);
      assert.notEqual(res.skipped, true, '스탬프 없었으므로 재적용되어야 함');
      assert.ok(existsSync(join(dest, '.dotclaude-installed')));
      assert.ok(existsSync(join(dest, 'dist', 'messenger', 'cli.js')));
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: messenger 파손 회귀 (수용 기준)', () => {
  test('구 dist(messenger 없음) + 새 래퍼 → apply 후 dist/messenger/cli.js 존재', () => {
    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-dest-'));
    try {
      // 구 설치본: messenger 없는 dist + 래퍼만 있는 상태
      write(join(dest, 'dist', 'hooks', 'bridge.js'), 'old bridge\n');
      write(join(dest, 'dist', 'hud', 'statusline.js'), 'old statusline\n');
      write(join(dest, 'scripts', 'messenger.sh'), 'old wrapper -> calls dist/messenger/cli.js\n');
      // messenger/cli.js 는 의도적으로 없음

      const r = run(['--scope', 'global', '--src', src, '--dest', dest]);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(existsSync(join(dest, 'dist', 'messenger', 'cli.js')),
        'recursive 복사가 messenger/cli.js 를 배포해야 함');
    } finally {
      cleanup(src, dest);
    }
  });
});

describe('apply-manifest: 뮤테이션 검증 (테스트 12)', () => {
  test('스탬프를 복사 前에 쓰도록 바꾸면 원자성 테스트가 실패하는지 자가검증', () => {
    // apply-manifest.mjs 를 복제해 "스탬프를 복사 루프 前에 기록"하도록 뮤테이트한
    // 변종을 만들고, 그 변종에 대해 원자성 시나리오(테스트 11)를 돌려
    // 반드시 실패(스탬프가 남아 다음 실행이 skip)하는지 확인한다.
    const srcCode = readFileSync(APPLY, 'utf8');

    // 뮤테이션: 복사 루프를 돌기 전에 스탬프를 먼저 쓰도록 개조.
    // 원본은 "복사 루프 → resolved manifest → 스탬프" 순서. 여기서는
    // 복사 루프 시작 직전에 스탬프를 강제로 기록해버린다(must-fix 1 위반).
    const marker = '  // ─── 복사 루프 (must-fix 3 원자성: throw 시 스탬프 미기록) ───';
    assert.ok(srcCode.includes(marker), '뮤테이션 앵커가 원본에 있어야 함');
    const injected = `  // [MUTANT] 스탬프를 복사 前에 기록 — 원자성 위반
  if (!dryRun) {
    if (scope === 'global') writeGlobalStamp(dest, repoSha, '0.0.0');
    else writeLocalStamp(dest, repoSha);
  }
`;
    const mutantCode = srcCode.replace(marker, injected + marker);

    const mutantPath = join(tmpdir(), `apply-mutant-${Date.now()}.mjs`);
    writeFileSync(mutantPath, mutantCode);

    const src = makeSrc();
    const dest = mkdtempSync(join(tmpdir(), 'dc-mut-'));
    try {
      // dist sentinel 파괴 → 복사 루프에서 fail
      rmSync(join(src, 'project-local', 'dist', 'messenger'), { recursive: true, force: true });
      let failCode;
      try {
        execFileSync('node', [mutantPath, '--scope', 'global', '--src', src, '--dest', dest], {
          stdio: 'ignore',
        });
        failCode = 0;
      } catch (e) { failCode = e.status ?? 1; }
      assert.equal(failCode, 1, '뮤턴트도 sentinel 에서 fail 해야 함');

      // 핵심: 뮤턴트는 복사 前에 스탬프를 썼으므로 스탬프가 남아있다 → 원자성 위반 증거
      const stampLeaked = existsSync(join(dest, '.dotclaude-installed'));
      assert.equal(stampLeaked, true,
        '뮤턴트는 복사 前 스탬프를 남긴다 (원본은 안 남김 — 테스트 11 이 이를 보장)');

      // 뮤턴트에서는 복구 후 재실행이 skip 되어 영구 미반영 = 치명적 시나리오 재현
      write(join(src, 'project-local', 'dist', 'messenger', 'cli.js'), 'messenger v1\n');
      let stdout = '';
      try {
        stdout = execFileSync('node', [mutantPath, '--scope', 'global', '--src', src, '--dest', dest], {
          encoding: 'utf8',
        });
      } catch (e) { stdout = e.stdout?.toString() ?? ''; }
      const res = parseResult(stdout);
      assert.equal(res.skipped, true,
        '뮤턴트는 스탬프가 남아 skip → messenger 영구 미배포 (원본이 방지하는 바로 그 버그)');
    } finally {
      cleanup(src, dest);
      rmSync(mutantPath, { force: true });
    }
  });
});
