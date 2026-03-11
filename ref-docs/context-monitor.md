# Context Monitor — HUD statusline + compaction 감지/복구 시스템

## 개요

두 가지 역할을 하나의 스크립트(`context-monitor.mjs`)에서 수행:
1. **HUD**: 버전, CWD, 리밋, ctx%, 에이전트 수를 statusline에 표시
2. **Compaction 대응**: context usage % 추적 → threshold 기반 live context 백업/복구

### HUD 출력 예시

```
[CC#1.0.80] | ~/work/myproject | 5h:45%(3h42m) wk:12%(2d5h) | ctx:14% | agents:3
```

| 슬롯 | 데이터 소스 |
|------|------------|
| CC 버전 | stdin `version` |
| CWD | stdin `workspace.current_dir` (~ 축약) |
| 5h 리밋 | OAuth API `https://api.anthropic.com/api/oauth/usage` |
| 주간 리밋 | OAuth API (동일) |
| ctx% | stdin `context_window.used_percentage` |
| agents | subagent transcript 파일 카운트 |

## 아키텍처

```
[매 턴] Statusline → context-monitor.mjs 실행
        ├─ stdin JSON 파싱 (version, workspace, context_window)
        ├─ OAuth API 호출 (캐시 90초 TTL) → rate limit 조회
        ├─ subagent transcript 파일 카운트
        ├─ .claude/.ctx_state에 ctx% 기록 (compaction 감지용)
        └─ 통합 HUD 한 줄 출력

[사용자 입력] on-prompt.sh (UserPromptSubmit hook)
        ├─ .ctx_state에서 alert 확인
        ├─ alert=high → "상태 저장하라" 리마인더 주입
        └─ alert=compacted → live_context 테이블에서 복구 주입 → alert 클리어

[AI 응답 중] AI가 live-set으로 상태 저장
```

## 파일 구조

| 파일 | 역할 |
|------|------|
| `.claude/scripts/context-monitor.mjs` | HUD + ctx% 캡처 통합 스크립트 |
| `.claude/.ctx_state` | JSON 상태 파일 (gitignore 대상) |
| `~/.claude/.hud_cache` | OAuth API 응답 캐시 (글로벌) |
| `.claude/db/context.db` → `live_context` 테이블 | 작업 상태 KV 저장소 |
| `.claude/hooks/on-prompt.sh` | 복구 주입 로직 |

## .ctx_state 형식

```json
{
  "current": 42,
  "previous": 38,
  "peak": 42,
  "alert": "none",
  "updated": "2026-03-07T15:54:10.000Z"
}
```

- `alert` 값: `none` | `high` (≥70%) | `compacted` (급감 감지)

## Alert 임계값

| 조건 | alert | 동작 |
|------|-------|------|
| ctx < 70% | `none` | 모니터링만 |
| ctx ≥ 70% | `high` | hook이 저장 리마인더 주입 |
| previous ≥ 70% → current < 40% | `compacted` | hook이 live_context 복구 주입 |

## live_context 테이블

```sql
CREATE TABLE live_context (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
```

### 표준 key

| key | 설명 |
|-----|------|
| `current_task` | 현재 작업 설명 |
| `working_files` | 작업 중인 파일 목록 |
| `key_findings` | 중요 발견사항 |
| `claude_md` | CLAUDE.md 핵심 내용 압축 (compaction 후 가이드 복구용) |

### Helper 명령

```bash
bash .claude/db/helper.sh live-set <key> <value>   # UPSERT
bash .claude/db/helper.sh live-get [key]            # 조회 (key 생략 시 전체)
bash .claude/db/helper.sh live-dump                 # 포맷된 전체 출력
bash .claude/db/helper.sh live-clear                # 전체 삭제
```

## OAuth API (Rate Limit)

- **엔드포인트**: `https://api.anthropic.com/api/oauth/usage`
- **인증**: macOS Keychain `Claude Code-credentials` 또는 `~/.claude/.credentials.json`
- **응답**: `{ five_hour: { utilization, resets_at }, seven_day: { utilization, resets_at } }`
- **캐시**: 성공 90초, 실패 15초 TTL → `~/.claude/.hud_cache`
- 인증 실패/API 불가 시 해당 슬롯 생략 (에러 없이 동작)

## 색상 코딩

| 대상 | 조건 | 색상 |
|------|------|------|
| 리밋 (5h/wk) | < 70% | 초록 |
| 리밋 (5h/wk) | 70-90% | 노랑 |
| 리밋 (5h/wk) | ≥ 90% | 빨강 |
| ctx% | < 60% | 초록 |
| ctx% | 60-80% | 노랑 |
| ctx% | ≥ 80% | 빨강 |
| ctx% | ≥ 85% | + CRITICAL |
| ctx% | ≥ 75% | + COMPRESS? |

## statusLine 설정 우선순위

```
Project .claude/settings.json  >  Global ~/.claude/settings.json
```

**Project에 `statusLine`이 있으면 Global을 완전 대체** (머지 아님).

### 설치 위치별 동작

| 설치 위치 | Global에 설정 | Project에 설정 | 실제 동작 |
|-----------|:---:|:---:|-----------|
| Global만 | ✅ | - | Global HUD → 모든 프로젝트 적용 |
| Project만 | - | ✅ | Project HUD → 해당 프로젝트만 |
| 둘 다 | ✅ | ✅ | **Project가 우선** (Global 무시) |

### Global 설치 (권장)

`~/.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/scripts/context-monitor.mjs",
    "padding": 2
  }
}
```

- 한 번 설치하면 모든 프로젝트에서 동작
- 프로젝트 `.claude/settings.json`에 `statusLine`이 **없어야** 적용됨

### Project 설치

`.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node .claude/scripts/context-monitor.mjs",
    "padding": 2
  }
}
```

- 해당 프로젝트에서만 동작
- Global 설정을 오버라이드

## 다른 프로젝트에 적용

1. `.claude/scripts/context-monitor.mjs` 복사
2. `.claude/hooks/on-prompt.sh`에 ctx_state 읽기 로직 추가
3. `.claude/db/init.sql`에 `live_context` 테이블 추가
4. `.claude/db/helper.sh`에 `live-*` 명령 추가
5. `.gitignore`에 `context.db`, `.ctx_state` 추가
6. statusLine 설정: Global (모든 프로젝트 공유) 또는 Project (개별 프로젝트)
