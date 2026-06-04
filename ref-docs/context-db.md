# Context DB — SQLite 기반 세션/태스크/결정 저장소. helper.sh CLI로 조작

## 개요

프로젝트 컨텍스트, 세션, 태스크, 결정사항 등을 `.claude/db/context.db`에 저장/관리합니다.
모든 에이전트는 작업 시 이 DB를 참조하고 저장해야 합니다.

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
│   ├── dotclaude-commit.md      # /project:dotclaude-commit
│   ├── dotclaude-tellme.md      # /project:dotclaude-tellme
│   └── dotclaude-discover.md    # /project:dotclaude-discover
└── settings.json      # Hook 등록
```

## DB 스키마 (v1.2)

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|----------|
| `sessions` | 작업 세션 기록 | start_time, end_time, duration_minutes, files_changed |
| `context` | 프로젝트 컨텍스트 (KV) | key, value, category, updated_at, **access_count, last_access_ts** (decay) |
| `context_fts` | context 전문검색 (FTS5 가상테이블, 트리거 동기화) | key, value |
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
| `ctx-get <key>` | 값 조회 (회상 시 access_count 증가 — decay 신호) |
| `ctx-set <key> <value> [category]` | 값 저장 (category: general, architecture, decision, feature, bug) |
| `ctx-search <keyword>` | 전문검색 (FTS5, 미지원 시 LIKE fallback) |
| `ctx-list [category]` | 목록 (decay 정렬: 자주 회상한 항목 우선) |

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

## 1M 컨텍스트 시대 활용 (schema v1.2)

컨텍스트 윈도우가 1M로 커지며 compaction→복구 의존도가 낮아졌다. DB의 무게추를 **세션 간 연속성 + 반복작업 효율화 + 메모리 품질**로 이동했다.

### 세션 간 연속성
- **핸드오프 주입(A1)**: Stop hook이 세션 종료 시 편집/커밋/결정/미완료 태스크를 `live_context.session_handoff`에 구조화 저장 → 다음 SessionStart가 주입한다. 새 세션이 직전 작업을 즉시 이어받는다 (LLM 요약이 아니라 구조화 블록).
- **메모리 인덱스(A2)**: SessionStart가 context를 통째 주입하지 않고 카테고리별 key 인덱스만 주입(decay 정렬). 상세는 `ctx-get`으로 on-demand.

### 메모리 품질 (벡터 없이 SQLite로)
- **Decay 재랭킹(C1)**: `context.access_count`/`last_access_ts`로 자주 회상한 항목을 상위 정렬. `ctx-get` 호출마다 누적.
- **FTS5 전문검색(C2)**: `context_fts` 가상테이블 + 트리거 자동 동기화. `ctx-search`가 MATCH 사용.

### 반복작업 효율화 (`/dotclaude-discover`, `/dotclaude-tellme`)
- 위험 파일(편집×에러), 반복 프롬프트(자산화 후보), change-coupling → skill/command 제안
- 작업 저널/standup 자동 생성 (커밋 타입 분류 + 핫스팟 + 결정/에러 집계)

### 마이그레이션
- schema 1.1 → 1.2는 **멱등 자동 적용**: helper.sh 호출 시 + SessionStart(db.ts `initSchema`)마다 `access_count` 컬럼 존재를 플래그로 1회 ALTER + FTS rebuild. 기존 `context.db`는 보존된다.

## DB Sync (집/사무실)

- DB 파일은 git에 포함됨
- 작업 시작: SessionStart hook이 자동 checkin (pull + 시간 기록)
- 작업 종료: `/project:dotclaude-commit`으로 DB 포함 push
- **규칙**: 항상 한쪽에서만 작업 → push → 다른 곳에서 pull → 작업
