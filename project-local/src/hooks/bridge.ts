/**
 * Hook Bridge — Claude Code 훅 이벤트를 처리하는 단일 진입점
 *
 * 환경변수 HOOK_EVENT로 이벤트 구분:
 *   session-start  → SessionStart 핸들러
 *   prompt         → UserPromptSubmit 핸들러
 *   post-edit      → PostToolUse (Edit/Write) 핸들러
 *   post-bash      → PostToolUse (Bash, 성공) 핸들러
 *   post-bash-fail → PostToolUseFailure (Bash, 실패) 핸들러
 *   stop           → Stop 통합 핸들러 (세션 통계 → handoff → ralph 판정 → 알림 → JSON)
 *
 * Stop은 한때 3개 훅(stop-session / stop-ralph / messenger notify &)으로 나뉘어 있었다.
 * 같은 이벤트의 훅은 병렬 실행이라 알림이 handoff보다 먼저 읽는 경합이 있었다 → events/stop.ts 참조.
 *
 * 흐름:
 *   stdin 읽기 → HOOK_EVENT 확인 → DB 연결 → 핸들러 실행 → stdout 출력 → DB 닫기
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextDB } from '../shared/db.js';
import { readStdin } from './stdin.js';
import { handleSessionStart } from './events/session-start.js';
import { handlePrompt } from './events/prompt.js';
import { handlePostEdit } from './events/post-edit.js';
import { handlePostBash } from './events/post-bash.js';
import { handlePostBashFailure } from './events/post-bash-failure.js';
import { handleStop } from './events/stop.js';

// === 프로젝트 루트 탐색 ===
function findProjectRoot(): string {
  // 1. PROJECT_ROOT 환경변수
  if (process.env['PROJECT_ROOT']) {
    return process.env['PROJECT_ROOT'];
  }
  // 2. 현재 파일에서 위로 탐색 (빌드 산출물 dist/hooks/bridge.js 기준)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // dist/hooks/bridge.js → 프로젝트 루트는 dist/../../ = 빌드 기준 2단계 위
  // 하지만 실제 배포 시에는 .claude/dist/hooks/bridge.js 위치
  // 공통 패턴: .claude 디렉토리를 포함하는 디렉토리를 탐색
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, '.claude'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // 루트 도달
    dir = parent;
  }
  // 3. cwd fallback
  return process.cwd();
}

// === 메인 ===
async function main(): Promise<void> {
  const hookEvent = process.env['HOOK_EVENT'] ?? '';
  if (!hookEvent) {
    process.stderr.write('[bridge] HOOK_EVENT 환경변수가 설정되지 않았습니다.\n');
    process.exit(1);
  }

  const stdinData = await readStdin();
  const projectRoot = findProjectRoot();
  const dbPath = join(projectRoot, '.claude/db/context.db');

  // DB 연결
  let db: ContextDB | null = null;
  try {
    // session-start는 DB가 없어도 생성해야 함
    if (hookEvent === 'session-start' || existsSync(dbPath)) {
      db = new ContextDB(dbPath);
    }
  } catch (err) {
    process.stderr.write(`[bridge] DB 연결 실패: ${err}\n`);
    // DB 없으면 조용히 진행 (hook 실패가 Claude 사용을 막으면 안 됨)
    db = null;
  }

  // stop만 DB 없이도 동작해야 한다 — ralph block 판정은 .ralph_state 파일만 보고,
  // 알림도 DB 재료 없이 나가야 한다(재료 부재는 섹션 생략일 뿐이다).
  // 나머지 이벤트는 DB가 전부이므로 없으면 할 일이 없다.
  if (hookEvent === 'stop') {
    try {
      await handleStop({ projectRoot, db, stdinData });
    } finally {
      db?.close();
    }
    return;
  }

  if (!db) return;

  try {
    switch (hookEvent) {
      case 'session-start':
        await handleSessionStart({ projectRoot, db });
        break;

      case 'prompt':
        await handlePrompt({ projectRoot, db });
        break;

      case 'post-edit':
        await handlePostEdit({ projectRoot, db, stdinData });
        break;

      case 'post-bash':
        await handlePostBash({ projectRoot, db, stdinData });
        break;

      case 'post-bash-fail':
        await handlePostBashFailure({ projectRoot, db, stdinData });
        break;

      default:
        process.stderr.write(`[bridge] 알 수 없는 HOOK_EVENT: ${hookEvent}\n`);
        break;
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[bridge] 치명적 오류: ${err}\n`);
  process.exit(1);
});
