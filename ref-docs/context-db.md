# Context DB — SQLite 기반 세션/결정/핸드오프 저장소. helper.sh CLI로 조작

## 개요

세션·결정·에러·커밋·작업 상태를 `.claude/db/context.db`에 저장한다. 훅은 TypeScript `db.ts` API로 직접 쓰고, 에이전트·슬래시 명령·사람은 `helper.sh` CLI로 조작한다.

> **범위 주의**: 이 DB는 "운영 이력 + compaction-safe 핸드오프"에 특화돼 있다. 사실·학습·선호의 영속 메모리는 Claude Code 네이티브 **auto-memory**(`~/.claude/projects/<proj>/memory/`, `/memory`)를 쓴다. 과거의 `tasks`·`context`(KV 메모리)·`prompts`·`context_fts`(전문검색) 테이블은 네이티브 TodoWrite/auto-memory와 중복이라 **제거됐다**(schema 1.3).

## 파일 구조

```
.claude/
├── db/
│   ├── init.sql       # DB 스키마 정의 (v1.3)
│   ├── context.db     # SQLite DB (git tracked)
│   └── helper.sh      # CLI helper
├── dist/hooks/bridge.js   # 모든 훅의 단일 진입점 (TS 빌드 산출물)
├── commands/          # 슬래시 명령
└── settings.json      # Hook 등록
```

훅은 별도 `.sh` 파일이 아니라 `bridge.js`에 번들돼 있다. → [Hooks](hooks.md)

## DB 스키마 (v1.3)

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|----------|
| `sessions` | 작업 세션 기록 | start_time, end_time, duration_minutes, files_changed |
| `decisions` | 설계 결정 이력 | description, reason, related_files, status |
| `tool_usage` | 편집 로그 | session_id, tool_name, file_path, timestamp |
| `errors` | 에러/이슈 로그 | error_type, file_path, resolution |
| `commits` | 커밋 기록 | hash, message, files_changed |
| `live_context` | compaction-safe 작업 상태 KV | key, value, updated_at |
| `db_meta` | DB 메타 정보 | schema_version, created_at |

`live_context`가 핵심이다 — 훅이 `session_handoff`·`session_summary`·`working_files`·`error_context`·`_task:*`/`_result:*`(에이전트 핸드오프) 등을 활발히 쓴다. → [live_context 상세](context-monitor.md)

## Helper 명령어

```bash
bash .claude/db/helper.sh <command> [args...]
```

| 분류 | 명령어 | 설명 |
|------|--------|------|
| 세션 | `session-current` / `session-info [n]` | 현재 세션 ID / 최근 N개 정보 |
| 결정 | `decision-add <desc> <reason> [files_json]` / `decision-list [n]` | 설계 결정 기록/조회 |
| 에러 | `error-log <type> <file> [resolution]` / `error-list [n]` | 에러 기록/조회 |
| 커밋 | `commit-log <hash> <message> [files_json]` | 커밋 기록 |
| 도구 | `tool-log <tool_name> <file_path>` | 편집 기록 |
| Live | `live-set <k> <v>` / `live-get [k]` / `live-dump` | compaction-safe KV 저장/조회/덤프 |
| 에이전트 | `agent-task` / `agent-context` / `agent-result` | 서브에이전트 핸드오프 KV |
| 유틸 | `stats` / `query <sql>` | 통계 / 직접 SQL |

> 모든 값 보간은 `_esc()`로 SQL 이스케이프된다(따옴표 안전). 훅은 이 CLI가 아니라 `db.ts`의 prepared statement를 쓴다.

## 에이전트 행동 규칙

1. **설계 결정 시**: `decision-add`로 결정과 이유를 기록
2. **버그 수정 시**: `error-log`로 에러 유형과 해결 방법 기록 (자동 에러 로깅은 [Hooks](hooks.md) 참조)
3. **커밋 시**: `commit-log`로 기록
4. **작업 상태**: `live-set`으로 compaction 대비 저장 (→ 핸드오프에 반영)
5. **할 일 관리**: 네이티브 TodoWrite 사용 (DB `tasks` 테이블은 제거됨)

## 세션 간 연속성

- **핸드오프 주입**: Stop 훅이 세션 종료 시 편집/커밋/결정을 `live_context.session_handoff`에 구조화 저장 → 다음 SessionStart가 주입한다. LLM 요약이 아니라 사실 블록이라 손실이 없다.
- **compaction 복구**: `live_context`를 결정적으로 재주입. → [Context Monitor](context-monitor.md)

## 마이그레이션

`helper.sh`가 호출 시 `schema_version`을 확인해 멱등 마이그레이션한다:

- **1.2 → 1.3**: 죽은 테이블 제거. `prompts`·`context_fts`(+트리거)는 무조건 DROP, `tasks`·`context`는 **0행 확인 후에만** DROP(만약의 데이터 보호). 살아있는 테이블과 데이터는 보존된다.

## DB Sync (집/사무실)

- DB 파일은 git에 포함됨
- 작업 종료: `/dotclaude-commit`으로 DB 포함 push
- **규칙**: 항상 한쪽에서만 작업 → push → 다른 곳에서 pull → 작업
