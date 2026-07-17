#!/usr/bin/env bash
# messenger.sh — Telegram 메신저 알림 (TS CLI 얇은 래퍼)
#
# 구현은 src/messenger/ (TypeScript)에 있고 dist/messenger/cli.js로 번들된다.
# 이 파일은 진입점 호환만 유지한다 — /dotclaude-messenger 슬래시 명령과
# settings.json 훅이 `bash .../messenger.sh <subcommand>` 형태로 호출하기 때문이다.
#
# 서브커맨드: config, test, on, off, send, status, notify, set, get, prompt-time
# 사용법은 `messenger.sh --help` 참조.

set -euo pipefail

# 프로젝트 로컬 dist 우선 → 글로벌 설치본 폴백 (훅 배선의 _B= 패턴과 동일).
# 개발 중인 레포에서 실행하면 프로젝트 dist가, 사용자 환경에서는 ~/.claude가 잡힌다.
_PROJ_ROOT="$(cat .claude/.project_root 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo .)"
_CLI="${_PROJ_ROOT}/.claude/dist/messenger/cli.js"
[ -f "${_CLI}" ] || _CLI="${HOME}/.claude/dist/messenger/cli.js"

if [ ! -f "${_CLI}" ]; then
    printf '\033[0;31m[error]\033[0m messenger CLI를 찾을 수 없습니다: %s\n' "${_CLI}" >&2
    printf '\033[0;34m[info]\033[0m  dotclaude 설치(install.sh) 또는 빌드(npm run build)가 필요합니다.\n' >&2
    exit 1
fi

exec node --no-warnings=ExperimentalWarning "${_CLI}" "$@"
