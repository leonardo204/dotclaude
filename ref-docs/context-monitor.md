# Context Monitor — HUD statusline + compaction 감지/복구 시스템

## 개요

HUD statusline은 `dist/hud/statusline.js`(TypeScript 빌드 산출물)가 담당하며, 두 역할을 수행:
1. **HUD**: 버전, CWD, 비용, 리밋, ctx%, 에이전트 수를 statusline에 표시
2. **Compaction 대응**: context usage % 추적 → threshold 기반 live context 백업/복구

> ⚠️ 구 `scripts/context-monitor.mjs`는 **제거됨** — 동일 기능이 `statusline.js`로 통합되었다. 실제 statusLine은 `dist/hud/statusline.js`이다.

### HUD 출력 예시

```
[CC#1.0.80] | ~/work/myproject (main) | $12.90 (today $1.2) | 5h:45%(3h42m) wk:12%(2d5h) | Opus | ctx:14% | agents:3
```

| 슬롯 | 데이터 소스 |
|------|------------|
| CC 버전 | stdin `version` |
| CWD (branch) | stdin `workspace.current_dir` (~ 축약) + `git branch` |
| 비용 | 프로젝트 JSONL 로그를 ccusage 방식으로 집계 → `~/.claude/.hud_cost_cache.json` (누적 + 오늘). 계산은 백그라운드 워커(`cost.js`) |
| 5h 리밋 | stdin `rate_limits.five_hour` 우선, 없으면 fetcher 캐시 |
| 주간 리밋 | stdin `rate_limits.seven_day` 우선, 없으면 fetcher 캐시 |
| 모델 | stdin `model.display_name` |
| ctx% | stdin `context_window.used_percentage` |
| agents | subagent transcript 파일 카운트 |

### 비용 집계 (cost.js 워커 + .hud_cost_cache.json)

비용은 **ccusage/codex-island와 동일한 ground-truth 방식**으로 계산한다: `~/.claude/projects/<프로젝트>/**/*.jsonl`(서브에이전트 포함)을 파싱해 assistant 메시지의 usage 토큰을 **`messageId:requestId`로 전역 중복제거**한 뒤, 모델별 flat 단가(litellm 스냅샷)를 곱한다. Opus 4.x·Fable 5는 1M 컨텍스트에도 프리미엄 요율이 없어 flat rate가 정확하다.

- **왜 stdin `cost.total_cost_usd`를 안 쓰나**: 트랜스크립트는 세션 resume/fork 시 같은 턴을 여러 파일에 중복 기록한다(관측상 ~57%). CC의 세션 비용 추정치는 무거운/resume된 세션에서 실측(중복제거) 대비 크게 부풀려져(관측상 3배) HUD 값을 신뢰할 수 없게 만든다. 그래서 로그를 직접 dedup 집계한다.
- **성능**: JSONL 파싱은 무거우므로 렌더 핫패스에서 하지 않는다. statusline은 캐시(`~/.claude/.hud_cost_cache.json`, cwd를 키로)만 읽고, 캐시가 없거나 8초 이상 오래되면 **detached 워커 `cost.js <cwd>`를 스폰**(fire-and-forget). 워커는 파일별 파싱 결과를 mtime+size로 캐시(`~/.claude/.hud_cost_parse/`)해 변경된 파일만 재파싱한다(steady-state ≈수십 ms). 락 파일(`.hud_cost.lock`)로 워커 몰림을 방지한다.
- 캐시 키가 cwd이므로 프로젝트에 `.claude/` 디렉토리가 없어도 동작한다. **누적(total)은 프로젝트 전체 기간**, **today는 로컬 날짜 기준**. 색상: 기본 green, ≥$50 yellow, ≥$200 red.

## 아키텍처

```
[매 턴] Statusline → dist/hud/statusline.js 실행
        ├─ stdin JSON 파싱 (version, workspace, context_window)
        ├─ OAuth API 호출 (캐시 90초 TTL) → rate limit 조회
        ├─ subagent transcript 파일 카운트
        ├─ .claude/.ctx_state에 ctx% 기록 (compaction 감지용)
        ├─ 비용 캐시(~/.claude/.hud_cost_cache.json) 읽기 + stale 시 cost.js 워커 스폰
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
| `~/.claude/dist/hud/statusline.js` | HUD + ctx% 캡처 (실제 statusLine) |
| `~/.claude/dist/hud/fetcher.js` | rate limit 백그라운드 폴백 (stdin 없을 때만) |
| `.claude/.ctx_state` | JSON 상태 파일 (gitignore 대상) |
| `~/.claude/dist/hud/cost.js` | 비용 집계 워커 (JSONL dedup·flat단가, 백그라운드 1회성) |
| `~/.claude/.hud_cost_cache.json` | 프로젝트별 누적/오늘 비용 캐시 (cwd 키, 글로벌) |
| `~/.claude/.hud_cost_parse/` | 파일별 파싱 캐시 (변경 파일만 재파싱) |
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

## Rate Limit 데이터 (stdin 우선)

1. **1차**: Claude Code가 statusline stdin으로 주는 `rate_limits.{five_hour,seven_day}`(CC 2.1+, Pro/Max, 첫 API 응답 후). **외부 호출 없음.**
2. **폴백**: stdin에 없을 때만 백그라운드 `dist/hud/fetcher.js`가 `api.anthropic.com/api/oauth/usage`를 OAuth로 조회 → `~/.claude/.hud_cache`(15분 갱신).
   - 인증: macOS Keychain `Claude Code-credentials` 또는 `~/.claude/.credentials.json`
   - 외부 전송 없음. `/dotclaude-statusline off` 또는 `~/.claude/.hud_disabled`로 비활성화.

## 색상 코딩

| 대상 | 조건 | 색상 |
|------|------|------|
| 리밋 (5h/wk) | < 70% | 초록 |
| 리밋 (5h/wk) | 70-90% | 노랑 |
| 리밋 (5h/wk) | ≥ 90% | 빨강 |
| ctx% | < 70% | 초록 |
| ctx% | 70-85% | 노랑 |
| ctx% | ≥ 85% | 빨강 |
| ctx% | ≥ 90% | + CRITICAL |
| ctx% | ≥ 80% | + COMPRESS? |

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
    "command": "node --no-warnings=ExperimentalWarning ~/.claude/dist/hud/statusline.js",
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
    "command": "node --no-warnings=ExperimentalWarning .claude/dist/hud/statusline.js",
    "padding": 2
  }
}
```

- 해당 프로젝트에서만 동작
- Global 설정을 오버라이드

## 다른 프로젝트에 적용

1. `.claude/dist/hud/statusline.js` + `fetcher.js` 복사
2. `.claude/hooks/on-prompt.sh`에 ctx_state 읽기 로직 추가
3. `.claude/db/init.sql`에 `live_context` 테이블 추가
4. `.claude/db/helper.sh`에 `live-*` 명령 추가
5. `.gitignore`에 `context.db`, `.ctx_state` 추가
6. statusLine 설정: Global (모든 프로젝트 공유) 또는 Project (개별 프로젝트)
