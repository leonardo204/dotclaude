/**
 * Hook Bridge — Claude Code 훅 이벤트를 처리하는 단일 진입점
 *
 * 환경변수 HOOK_EVENT로 이벤트 구분:
 *   session-start  → SessionStart 핸들러
 *   prompt         → UserPromptSubmit 핸들러
 *   post-edit      → PostToolUse (Edit/Write) 핸들러
 *   post-bash      → PostToolUse (Bash) 핸들러
 *   stop-session   → Stop (세션 통계) 핸들러
 *   stop-ralph     → Stop (ralph persist) 핸들러
 *
 * 흐름:
 *   stdin 읽기 → HOOK_EVENT 확인 → DB 연결 → 핸들러 실행 → stdout 출력 → DB 닫기
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextDB } from '../shared/db.js';
import { handleSessionStart } from './events/session-start.js';
import { handlePrompt } from './events/prompt.js';
import { handlePostEdit } from './events/post-edit.js';
import { handlePostBash } from './events/post-bash.js';
import { handleStopSession } from './events/stop-session.js';
import { handleStopRalph } from './events/stop-ralph.js';

// === stdin 읽기 ===
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (result: string) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => done(data.trim()));
    // stdin이 없거나 바로 닫히면 빈 문자열 반환
    setTimeout(() => done(data.trim()), 50);
  });
}

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

  // stop-ralph는 DB 없이도 동작 가능
  if (hookEvent === 'stop-ralph') {
    await handleStopRalph({ projectRoot, stdinData });
    return;
  }

  // DB 연결
  let db: ContextDB | null = null;
  try {
    // session-start는 DB가 없어도 생성해야 함
    if (hookEvent === 'session-start' || existsSync(dbPath)) {
      db = new ContextDB(dbPath);
    }
  } catch (err) {
    process.stderr.write(`[bridge] DB 연결 실패: ${err}\n`);
    // DB 없으면 조용히 종료 (hook 실패가 Claude 사용을 막으면 안 됨)
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

      case 'stop-session':
        await handleStopSession({ db });
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
