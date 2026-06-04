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
    "command": "node --no-warnings=ExperimentalWarning ~/.claude/dist/hud/statusline.js",
    "padding": 2
  }
}
```

- 이 설정은 1회만 하면 모든 프로젝트에 적용됨

## 서브에이전트 권한 (쓰기 도구 주의)

`ralph`·`test-engineer`는 Edit/Write/Bash 쓰기 도구를 가진다. **서브에이전트는 권한 프롬프트를 띄울 수 없으므로**, 권한이 `ask`로 설정된 도구를 호출하면 조용히 거부되어 멈출 수 있다(메인에 알림 없음).

→ 구현 파이프라인을 쓰기 전, 다음 중 하나를 권장:
- 세션을 `acceptEdits` 모드로 실행, 또는
- `.claude/settings.json`의 `permissions.allow`에 필요한 Edit/Write/Bash 범위를 사전 등록.

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
| ralph/test-engineer가 조용히 멈춤 | 쓰기 권한이 `ask` 모드 (서브에이전트는 프롬프트 불가) | `acceptEdits` 모드 또는 settings.json `allow` 사전 등록 |
