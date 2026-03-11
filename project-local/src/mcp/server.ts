/**
 * MCP Server — dotclaude Context DB MCP 서버
 *
 * Claude Code settings.json의 mcpServers 섹션에 등록하여 사용:
 *
 *   "mcpServers": {
 *     "dotclaude": {
 *       "command": "node",
 *       "args": ["--no-warnings=ExperimentalWarning", ".claude/dist/mcp/server.js"]
 *     }
 *   }
 *
 * 선택적 기능 — 활성화하려면 위 설정을 Claude Code settings.json에 추가한다.
 * 기본값: 비활성 (비활성 시 기존 hook 기능에 영향 없음)
 *
 * 환경변수:
 *   PROJECT_ROOT — 프로젝트 루트 경로 (미지정 시 자동 탐색)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { ContextDB } from '../shared/db.js';
import { registerTools } from './tools.js';

// === 프로젝트 루트 탐색 ===

function findProjectRoot(): string {
  // 1. 환경변수 PROJECT_ROOT
  if (process.env['PROJECT_ROOT']) {
    return process.env['PROJECT_ROOT'];
  }

  // 2. process.cwd()에서 .claude/db/context.db 탐색
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, '.claude', 'db', 'context.db'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // 루트 도달
    dir = parent;
  }

  // 3. 현재 파일(.claude/dist/mcp/server.js)에서 위로 탐색
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  let fileDir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(fileDir, '.claude'))) {
      return fileDir;
    }
    const parent = dirname(fileDir);
    if (parent === fileDir) break;
    fileDir = parent;
  }

  // 4. git rev-parse --show-toplevel fallback
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (gitRoot) return gitRoot;
  } catch {
    // git 없는 환경 무시
  }

  // 5. cwd fallback
  return process.cwd();
}

// === 메인 ===

async function main(): Promise<void> {
  const projectRoot = findProjectRoot();
  const dbPath = join(projectRoot, '.claude', 'db', 'context.db');

  // DB 연결
  let db: ContextDB;
  try {
    db = new ContextDB(dbPath);
  } catch (err) {
    process.stderr.write(
      `[mcp-server] DB 연결 실패: ${err}\n  경로: ${dbPath}\n`
    );
    process.exit(1);
  }

  // MCP 서버 생성
  const server = new McpServer({
    name: 'dotclaude-context',
    version: '1.0.0',
  });

  // 도구 등록 (10개)
  registerTools(server, db);

  // stdio transport로 연결
  const transport = new StdioServerTransport();

  // 종료 시 DB 닫기
  const cleanup = () => {
    try {
      db.close();
    } catch {
      // 무시
    }
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  await server.connect(transport);

  process.stderr.write(
    `[mcp-server] dotclaude-context 시작됨\n  프로젝트 루트: ${projectRoot}\n  DB: ${dbPath}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[mcp-server] 치명적 오류: ${err}\n`);
  process.exit(1);
});
