/**
 * MCP 도구 등록 — Context DB 6개 핵심 도구 + 팀 협업 4개 도구
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ContextDB } from '../shared/db.js';

export function registerTools(server: McpServer, db: ContextDB): void {
  // =========================================================================
  // 핵심 도구 (Context DB 접근)
  // =========================================================================

  /**
   * 1. db_query — 임의 SQL 조회 (SELECT만 허용)
   */
  server.registerTool(
    'db_query',
    {
      description: 'Context DB에 임의 SQL SELECT 쿼리를 실행하고 결과를 반환한다.',
      inputSchema: {
        sql: z.string().describe('실행할 SQL SELECT 문'),
      },
    },
    ({ sql }) => {
      if (!sql.trim().toUpperCase().startsWith('SELECT')) {
        return {
          content: [{ type: 'text' as const, text: 'Error: SELECT 쿼리만 허용됩니다.' }],
          isError: true,
        };
      }
      try {
        const rows = db.query(sql);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `쿼리 실행 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * 2. task_list — 태스크 목록 조회
   */
  server.registerTool(
    'task_list',
    {
      description: '태스크 목록을 조회한다. status를 지정하지 않으면 pending 태스크를 반환한다.',
      inputSchema: {
        status: z
          .enum(['pending', 'in_progress', 'done', 'all'])
          .optional()
          .describe('필터링할 태스크 상태 (미지정 시 pending)'),
      },
    },
    ({ status }) => {
      try {
        const tasks = db.taskList(status);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(tasks, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `태스크 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * 3. task_add — 태스크 추가
   */
  server.registerTool(
    'task_add',
    {
      description: '새 태스크를 추가하고 생성된 ID를 반환한다.',
      inputSchema: {
        description: z.string().describe('태스크 설명'),
        priority: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('우선순위 1(높음)~5(낮음), 기본값 3'),
        category: z.string().optional().describe('태스크 카테고리'),
      },
    },
    ({ description, priority, category }) => {
      try {
        const id = db.taskAdd(description, priority ?? 3, category ?? '');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ id, description, priority: priority ?? 3 }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `태스크 추가 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * 4. decision_add — 결정 기록
   */
  server.registerTool(
    'decision_add',
    {
      description: '기술적 결정을 기록하고 생성된 ID를 반환한다.',
      inputSchema: {
        description: z.string().describe('결정 내용'),
        rationale: z.string().optional().describe('결정 이유/근거'),
      },
    },
    ({ description, rationale }) => {
      try {
        const id = db.decisionAdd(description, rationale);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ id, description }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `결정 기록 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * 5. live_get — 라이브 컨텍스트 조회
   */
  server.registerTool(
    'live_get',
    {
      description: 'live_context 테이블에서 key로 값을 조회한다.',
      inputSchema: {
        key: z.string().describe('조회할 컨텍스트 키'),
      },
    },
    ({ key }) => {
      try {
        const value = db.liveGet(key);
        return {
          content: [
            {
              type: 'text' as const,
              text: value !== null ? value : '(null — 키가 존재하지 않음)',
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `컨텍스트 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * 6. live_set — 라이브 컨텍스트 설정
   */
  server.registerTool(
    'live_set',
    {
      description: 'live_context 테이블에 key-value를 저장(upsert)한다.',
      inputSchema: {
        key: z.string().describe('저장할 컨텍스트 키'),
        value: z.string().describe('저장할 값'),
      },
    },
    ({ key, value }) => {
      try {
        db.liveSet(key, value);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, key }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `컨텍스트 저장 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // =========================================================================
  // 팀 도구 (멀티 에이전트 협업)
  // =========================================================================

  /**
   * 7. team_dispatch — 워커에게 작업 디스패치
   */
  server.registerTool(
    'team_dispatch',
    {
      description: '워커 에이전트에게 태스크를 디스패치한다. helper.sh agent-task와 동등.',
      inputSchema: {
        worker_name: z.string().describe('워커 에이전트 이름 (예: ralph, verifier)'),
        task_description: z.string().describe('워커에게 전달할 태스크 내용'),
        priority: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('우선순위 1(높음)~5(낮음), 기본값 3'),
      },
    },
    ({ worker_name, task_description, priority: _priority }) => {
      try {
        db.agentTask(worker_name, task_description);
        // 선택적으로 tasks 테이블에도 등록
        const taskId = db.taskAdd(
          `[${worker_name}] ${task_description}`,
          _priority ?? 3,
          'agent'
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                worker_name,
                task_id: taskId,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `디스패치 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * 8. team_status — 팀 작업 현황 조회
   */
  server.registerTool(
    'team_status',
    {
      description: '팀 에이전트의 작업 현황을 조회한다. worker_name 미지정 시 전체 현황 반환.',
      inputSchema: {
        worker_name: z
          .string()
          .optional()
          .describe('특정 워커 이름 (미지정 시 전체)'),
      },
    },
    ({ worker_name }) => {
      try {
        // agent tasks는 live_context의 _task:* 키로 관리됨
        const allContext = db.liveDump();
        const agentKeys = Object.entries(allContext).filter(([k]) =>
          k.startsWith('_task:')
        );

        if (worker_name) {
          const taskKey = `_task:${worker_name}`;
          const resultKey = `_result:${worker_name}`;
          const task = allContext[taskKey] ?? null;
          const result = allContext[resultKey] ?? null;

          const status = result
            ? 'done'
            : task
            ? 'in_progress'
            : 'no_task';

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  worker: worker_name,
                  status,
                  task,
                  result,
                }),
              },
            ],
          };
        }

        // 전체 현황
        const workers = agentKeys.map(([k, v]) => {
          const name = k.replace('_task:', '');
          const resultKey = `_result:${name}`;
          const result = allContext[resultKey] ?? null;
          return {
            worker: name,
            status: result ? 'done' : 'in_progress',
            task: v,
            result,
          };
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  total: workers.length,
                  workers,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `팀 현황 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * 9. team_result — 워커 결과 조회
   */
  server.registerTool(
    'team_result',
    {
      description: '워커 에이전트의 작업 결과를 조회한다. helper.sh agent-result와 동등.',
      inputSchema: {
        worker_name: z.string().describe('결과를 조회할 워커 에이전트 이름'),
      },
    },
    ({ worker_name }) => {
      try {
        const result = db.agentResultGet(worker_name);
        return {
          content: [
            {
              type: 'text' as const,
              text:
                result !== null
                  ? result
                  : `(null — ${worker_name}의 결과가 아직 없음)`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `결과 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * 10. team_context — 팀 공유 컨텍스트 읽기/쓰기
   */
  server.registerTool(
    'team_context',
    {
      description:
        '팀 공유 컨텍스트를 읽거나 쓴다. value 미지정 시 조회, 지정 시 저장. helper.sh agent-context와 동등.',
      inputSchema: {
        key: z.string().describe('컨텍스트 키'),
        value: z
          .string()
          .optional()
          .describe('저장할 값 (미지정 시 읽기 모드)'),
      },
    },
    ({ key, value }) => {
      try {
        if (value !== undefined) {
          // 쓰기 모드
          db.agentContext(key, value);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ success: true, key }),
              },
            ],
          };
        } else {
          // 읽기 모드
          const result = db.agentContext(key);
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  result !== null
                    ? result
                    : `(null — 키 '${key}'가 존재하지 않음)`,
              },
            ],
          };
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `팀 컨텍스트 처리 실패: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
