# 셋업 — 새 환경에서 dotclaude 프로젝트 클론 후 초기 설정 가이드

## 필수 도구

- **Claude Code**: 설치 후 프로젝트 디렉토리에서 실행
- **sqlite3**: macOS/Linux 기본 내장
- **node**: Claude Code 설치 시 포함

## 글로벌 설정

`~/.claude/settings.json`에 statusline 추가:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/scripts/context-monitor.mjs",
    "padding": 2
  }
}
```

- 이 설정은 1회만 하면 모든 프로젝트에 적용됨

## 자동 초기화

- 첫 세션 시작 시 `.claude/db/context.db`가 없으면 `init.sql`로 자동 생성
- `.claude/.ctx_state`는 statusline 첫 실행 시 자동 생성

## gitignore 확인

다음 파일이 `.gitignore`에 포함되어야 함 (머신별 로컬 데이터):

```
.claude/db/context.db
.claude/.ctx_state
```

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| HUD에 ctx% 안 보임 | statusline 설정 누락 | `~/.claude/settings.json` 확인 |
| `context.db not found` | 첫 세션 전 | 세션 시작하면 자동 생성 |
| hook 출력 안 됨 | 프로젝트 settings.json 누락 | `.claude/settings.json`에 hooks 설정 확인 |
