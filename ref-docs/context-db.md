# Project Context DB (SQLite)

## 개요

프로젝트 컨텍스트, 세션, 태스크, 결정사항 등을 `.claude/db/context.db`에 저장/관리합니다.
모든 에이전트(OMC 포함)는 작업 시 이 DB를 참조하고 저장해야 합니다.

## 파일 구조

```
.claude/
├── db/
│   ├── init.sql       # DB 스키마 정의
│   ├── context.db      # SQLite DB (git tracked)
│   └── helper.sh      # CLI helper 스크립트
├── hooks/
│   ├── session-start.sh      # SessionStart: 자동 checkin
│   ├── on-prompt.sh          # UserPromptSubmit: 컨텍스트 주입
│   ├── post-tool-edit.sh     # PostToolUse:Edit: 편집 로깅
│   ├── post-tool-bash.sh     # PostToolUse:Bash: 에러 감지
│   └── on-stop.sh            # Stop: 세션 통계 갱신
├── commands/
│   ├── commit.md      # /project:commit
│   ├── tellme.md      # /project:tellme
│   └── discover.md    # /project:discover
└── settings.json      # Hook 등록
```

## DB 스키마 (v1.0)

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|----------|
| `sessions` | 작업 세션 기록 | start_time, end_time, duration_minutes, files_changed |
| `context` | 프로젝트 컨텍스트 (KV) | key, value, category, updated_at |
| `decisions` | 설계 결정 이력 | description, reason, related_files, status |
| `tasks` | 할일/태스크 | description, priority(1-4), status, category |
| `tool_usage` | 도구 사용 로그 | session_id, tool_name, file_path, timestamp |
| `prompts` | 프롬프트 로그 | session_id, content_hash, keyword_tags |
| `errors` | 에러/이슈 로그 | error_type, file_path, resolution |
| `commits` | 커밋 기록 | hash, message, files_changed |
| `db_meta` | DB 메타 정보 | schema_version, created_at |

## Helper 명령어

```bash
bash .claude/db/helper.sh <command> [args...]
```

### 세션
| 명령어 | 설명 |
|--------|------|
| `session-current` | 현재 세션 ID |
| `session-info [n]` | 최근 N개 세션 정보 |

### 컨텍스트
| 명령어 | 설명 |
|--------|------|
| `ctx-get <key>` | 값 조회 |
| `ctx-set <key> <value> [category]` | 값 저장 (category: general, architecture, decision, feature, bug) |
| `ctx-search <keyword>` | 키워드 검색 |
| `ctx-list [category]` | 목록 (카테고리별 또는 전체 요약) |

### 태스크
| 명령어 | 설명 |
|--------|------|
| `task-add <desc> [priority] [category]` | 추가 (priority: 1=urgent, 2=high, 3=normal, 4=low) |
| `task-list [status\|all]` | 목록 (status: pending, in_progress, done, cancelled) |
| `task-done <id>` | 완료 처리 |
| `task-update <id> <status>` | 상태 변경 |

### 기록
| 명령어 | 설명 |
|--------|------|
| `decision-add <desc> <reason> [files_json]` | 설계 결정 기록 |
| `decision-list [n]` | 최근 N개 결정 |
| `error-log <type> <file> [resolution]` | 에러 기록 |
| `error-list [n]` | 최근 N개 에러 |
| `commit-log <hash> <message> [files_json]` | 커밋 기록 |
| `tool-log <tool_name> <file_path>` | 도구 사용 기록 |

### 유틸
| 명령어 | 설명 |
|--------|------|
| `stats` | 전체 DB 통계 |
| `query <sql>` | 직접 SQL 실행 |

## 에이전트 행동 규칙

1. **설계 결정 시**: `decision-add`로 결정 사항과 이유를 반드시 기록
2. **버그 수정 시**: `error-log`로 에러 유형과 해결 방법 기록
3. **새 기능 구현 시**: `ctx-set`으로 기능 요약을 category="feature"로 저장
4. **커밋 시**: `commit-log`로 커밋 기록 저장
5. **태스크 발견 시**: `task-add`로 추가, 완료 시 `task-done`

## DB Sync (집/사무실)

- DB 파일은 git에 포함됨
- 작업 시작: SessionStart hook이 자동 checkin (pull + 시간 기록)
- 작업 종료: `/project:commit`으로 DB 포함 push
- **규칙**: 항상 한쪽에서만 작업 → push → 다른 곳에서 pull → 작업
