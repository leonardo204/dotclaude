#!/usr/bin/env bash
# messenger.sh — Telegram 메신저 알림 스크립트
# 사용법: messenger.sh <subcommand> [args]
# 서브커맨드: config, test, on, off, send, status, notify, set, get

set -euo pipefail

# ─── 설정 ───
CONFIG_FILE="${HOME}/.claude/messenger.json"

# ─── 색상 ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${BLUE}[info]${RESET}  %s\n" "$1"; }
warn()  { printf "${YELLOW}[warn]${RESET}  %s\n" "$1"; }
error() { printf "${RED}[error]${RESET} %s\n" "$1" >&2; }
ok()    { printf "${GREEN}[ok]${RESET}    %s\n" "$1"; }

# ─── 도움말 ───
show_help() {
    echo ""
    printf "${BOLD}messenger.sh${RESET} — Telegram 메신저 알림 스크립트\n"
    echo ""
    echo "사용법:"
    echo "  messenger.sh config <bot_token> <chat_id>  봇 토큰과 채팅 ID 설정"
    echo "  messenger.sh test                           테스트 메시지 전송"
    echo "  messenger.sh on                             알림 활성화"
    echo "  messenger.sh off                            알림 비활성화"
    echo "  messenger.sh send \"메시지\"                  메시지 전송"
    echo "  messenger.sh status                         현재 설정 상태 표시"
    echo "  messenger.sh notify                         세션 종료 알림 (Stop hook 전용)"
    echo "  messenger.sh set min_duration <초>          최소 알림 시간 설정"
    echo "  messenger.sh set scope <global|project>     알림 범위 설정"
    echo "  messenger.sh get <key>                      설정값 조회"
    echo ""
    echo "설정 파일: ${CONFIG_FILE}"
    echo ""
    echo "예시:"
    echo "  messenger.sh config 8714774691:AAE3eebo... 36737902"
    echo "  messenger.sh test"
    echo "  messenger.sh send \"빌드 완료!\""
    echo "  messenger.sh set min_duration 300"
    echo "  messenger.sh set scope project"
    echo ""
}

# ─── 설정 파일 읽기 ───
read_config() {
    if [ ! -f "${CONFIG_FILE}" ]; then
        return 1
    fi
    BOT_TOKEN=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.bot_token||'')" 2>/dev/null || true)
    CHAT_ID=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(String(c.chat_id||''))" 2>/dev/null || true)
    ENABLED=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(String(c.enabled===false?'false':'true'))" 2>/dev/null || echo "true")
    MIN_DURATION=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(String(c.min_duration||0))" 2>/dev/null || echo "0")
    SCOPE=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.scope||'global')" 2>/dev/null || echo "global")
    return 0
}

# ─── 설정 파일 쓰기 ───
write_config() {
    local token="$1"
    local chat="$2"
    local enabled="${3:-true}"
    local min_duration="${4:-0}"
    local scope="${5:-global}"
    mkdir -p "$(dirname "${CONFIG_FILE}")"
    node -e "
const fs = require('fs');
const config = {
  bot_token: '${token}',
  chat_id: '${chat}',
  enabled: ${enabled},
  min_duration: ${min_duration},
  scope: '${scope}'
};
fs.writeFileSync('${CONFIG_FILE}', JSON.stringify(config, null, 2) + '\n');
"
    chmod 600 "${CONFIG_FILE}"
}

# ─── Telegram API 메시지 전송 ───
send_telegram() {
    local token="$1"
    local chat="$2"
    local message="$3"

    local response
    response=$(curl -s "https://api.telegram.org/bot${token}/sendMessage" \
        -d "chat_id=${chat}" \
        --data-urlencode "text=${message}" \
        -d "parse_mode=HTML" 2>/dev/null)

    # ok 필드 확인
    local success
    success=$(node -e "
try {
  const r = JSON.parse(process.argv[1]);
  process.stdout.write(r.ok ? 'true' : 'false');
} catch(e) { process.stdout.write('false'); }
" "${response}" 2>/dev/null || echo "false")

    if [ "${success}" = "true" ]; then
        return 0
    else
        local err_desc
        err_desc=$(node -e "
try {
  const r = JSON.parse(process.argv[1]);
  process.stdout.write(r.description || '알 수 없는 오류');
} catch(e) { process.stdout.write('파싱 실패'); }
" "${response}" 2>/dev/null || echo "알 수 없는 오류")
        error "Telegram API 오류: ${err_desc}"
        return 1
    fi
}

# ─── 서브커맨드: config ───
cmd_config() {
    if [ $# -lt 2 ]; then
        error "사용법: messenger.sh config <bot_token> <chat_id>"
        exit 1
    fi
    local token="$1"
    local chat="$2"

    # 기존 설정의 enabled/min_duration/scope 값 유지
    local enabled="true"
    local min_duration="0"
    local scope="global"
    if read_config 2>/dev/null; then
        enabled="${ENABLED}"
        min_duration="${MIN_DURATION}"
        scope="${SCOPE}"
    fi

    write_config "${token}" "${chat}" "${enabled}" "${min_duration}" "${scope}"
    ok "설정 저장 완료: ${CONFIG_FILE}"
    info "권한 설정: chmod 600 (소유자만 읽기/쓰기)"
    info "bot_token: ${token:0:10}..."
    info "chat_id: ${chat}"
    echo ""
    info "테스트: messenger.sh test"
}

# ─── 서브커맨드: test ───
cmd_test() {
    if ! read_config 2>/dev/null; then
        error "설정 파일이 없습니다."
        error "먼저 설정하세요: messenger.sh config <bot_token> <chat_id>"
        exit 1
    fi
    if [ -z "${BOT_TOKEN}" ] || [ -z "${CHAT_ID}" ]; then
        error "bot_token 또는 chat_id가 비어 있습니다."
        error "다시 설정하세요: messenger.sh config <bot_token> <chat_id>"
        exit 1
    fi

    info "테스트 메시지 전송 중..."
    local msg="[dotclaude] 텔레그램 알림 테스트 성공! ✅"
    if send_telegram "${BOT_TOKEN}" "${CHAT_ID}" "${msg}"; then
        ok "테스트 메시지 전송 완료"
    else
        error "테스트 메시지 전송 실패"
        exit 1
    fi
}

# ─── 서브커맨드: on ───
cmd_on() {
    if ! read_config 2>/dev/null; then
        error "설정 파일이 없습니다."
        error "먼저 설정하세요: messenger.sh config <bot_token> <chat_id>"
        exit 1
    fi
    write_config "${BOT_TOKEN}" "${CHAT_ID}" "true" "${MIN_DURATION}" "${SCOPE}"
    ok "알림 활성화됨"
}

# ─── 서브커맨드: off ───
cmd_off() {
    if ! read_config 2>/dev/null; then
        error "설정 파일이 없습니다."
        error "먼저 설정하세요: messenger.sh config <bot_token> <chat_id>"
        exit 1
    fi
    write_config "${BOT_TOKEN}" "${CHAT_ID}" "false" "${MIN_DURATION}" "${SCOPE}"
    ok "알림 비활성화됨"
}

# ─── 서브커맨드: send ───
cmd_send() {
    if [ $# -lt 1 ]; then
        error "사용법: messenger.sh send \"메시지\""
        exit 1
    fi
    local message="$1"

    if ! read_config 2>/dev/null; then
        # 설정 없으면 안내하고 종료 (에러 아님 — 스킵)
        info "Telegram 알림 미설정 — 전송 스킵"
        info "설정하려면: messenger.sh config <bot_token> <chat_id>"
        return 0
    fi

    if [ -z "${BOT_TOKEN}" ] || [ -z "${CHAT_ID}" ]; then
        info "bot_token 또는 chat_id가 비어 있음 — 전송 스킵"
        return 0
    fi

    # 비활성화 상태면 스킵
    if [ "${ENABLED}" = "false" ]; then
        info "알림 비활성화 상태 — 전송 스킵 (활성화: messenger.sh on)"
        return 0
    fi

    if send_telegram "${BOT_TOKEN}" "${CHAT_ID}" "${message}"; then
        ok "메시지 전송 완료"
    else
        error "메시지 전송 실패"
        exit 1
    fi
}

# ─── 서브커맨드: set ───
cmd_set() {
    if [ $# -lt 2 ]; then
        error "사용법: messenger.sh set <min_duration|scope> <값>"
        exit 1
    fi
    local key="$1"
    local value="$2"

    if ! read_config 2>/dev/null; then
        error "설정 파일이 없습니다."
        error "먼저 설정하세요: messenger.sh config <bot_token> <chat_id>"
        exit 1
    fi

    case "${key}" in
        min_duration)
            # 숫자인지 확인
            if ! [[ "${value}" =~ ^[0-9]+$ ]]; then
                error "min_duration 은 정수(초)여야 합니다. 예: messenger.sh set min_duration 300"
                exit 1
            fi
            write_config "${BOT_TOKEN}" "${CHAT_ID}" "${ENABLED}" "${value}" "${SCOPE}"
            local human
            human=$(format_duration "${value}")
            ok "최소 알림 시간 설정: ${value}초 (${human}) — 이 시간 미만 작업은 알림 스킵"
            ;;
        scope)
            if [ "${value}" != "global" ] && [ "${value}" != "project" ]; then
                error "scope 는 'global' 또는 'project' 이어야 합니다."
                exit 1
            fi
            write_config "${BOT_TOKEN}" "${CHAT_ID}" "${ENABLED}" "${MIN_DURATION}" "${value}"
            ok "알림 범위 설정: ${value}"
            if [ "${value}" = "project" ]; then
                info "프로젝트별 활성화: 해당 프로젝트에서 /dotclaude-messenger 실행 후 메뉴 4번 선택"
            fi
            ;;
        *)
            error "알 수 없는 설정 키: ${key} (사용 가능: min_duration, scope)"
            exit 1
            ;;
    esac
}

# ─── 서브커맨드: get ───
cmd_get() {
    if [ $# -lt 1 ]; then
        error "사용법: messenger.sh get <key>"
        exit 1
    fi
    local key="$1"

    if ! read_config 2>/dev/null; then
        echo ""
        return 0
    fi

    case "${key}" in
        bot_token)    printf '%s\n' "${BOT_TOKEN}" ;;
        chat_id)      printf '%s\n' "${CHAT_ID}" ;;
        enabled)      printf '%s\n' "${ENABLED}" ;;
        min_duration) printf '%s\n' "${MIN_DURATION}" ;;
        scope)        printf '%s\n' "${SCOPE}" ;;
        *)
            error "알 수 없는 키: ${key} (사용 가능: bot_token, chat_id, enabled, min_duration, scope)"
            exit 1
            ;;
    esac
}

# ─── DB 경로 탐색 ───
find_db() {
    local proj_root
    proj_root=$(cat .claude/.project_root 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo ".")
    local db="${proj_root}/.claude/db/context.db"
    if [ -f "${db}" ]; then
        echo "${db}"
        return 0
    fi
    return 1
}

# ─── 시간 단위 자동 변환 (초 → 읽기 좋은 문자열) ───
format_duration() {
    local sec="${1:-0}"
    if [ "${sec}" -ge 3600 ] 2>/dev/null; then
        local h=$((sec / 3600))
        local m=$(( (sec % 3600) / 60 ))
        if [ "${m}" -gt 0 ]; then echo "${h}시간 ${m}분"; else echo "${h}시간"; fi
    elif [ "${sec}" -ge 60 ] 2>/dev/null; then
        local m=$((sec / 60))
        local s=$((sec % 60))
        if [ "${s}" -gt 0 ]; then echo "${m}분 ${s}초"; else echo "${m}분"; fi
    elif [ "${sec}" -gt 0 ] 2>/dev/null; then
        echo "${sec}초"
    else
        echo "1초 미만"
    fi
}

# ─── scope 체크: project 모드일 때 현재 디렉토리에 .messenger_enabled 파일 존재 확인 ───
check_scope() {
    local scope="${1:-global}"
    if [ "${scope}" = "project" ]; then
        # CWD 기준으로 .claude/.messenger_enabled 파일 확인
        local proj_root
        proj_root=$(cat .claude/.project_root 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo ".")
        if [ ! -f "${proj_root}/.claude/.messenger_enabled" ]; then
            return 1
        fi
    fi
    return 0
}

# ─── 서브커맨드: notify (Stop hook 전용) ───
cmd_notify() {
    # enabled 체크 — 비활성화면 즉시 종료
    if ! read_config 2>/dev/null; then
        exit 0
    fi
    if [ -z "${BOT_TOKEN}" ] || [ -z "${CHAT_ID}" ]; then
        exit 0
    fi
    if [ "${ENABLED}" = "false" ]; then
        exit 0
    fi

    # 중복 방지: 마지막 알림 후 30초 이내면 스킵
    local dedup_file="${HOME}/.claude/.messenger_last_notify"
    local now_epoch
    now_epoch=$(date +%s 2>/dev/null || echo "0")
    if [ -f "${dedup_file}" ]; then
        local last_epoch
        last_epoch=$(cat "${dedup_file}" 2>/dev/null || echo "0")
        if [ "${now_epoch}" -gt 0 ] 2>/dev/null && [ "${last_epoch}" -gt 0 ] 2>/dev/null; then
            local diff=$((now_epoch - last_epoch))
            if [ "${diff}" -lt 30 ]; then
                exit 0
            fi
        fi
    fi
    echo "${now_epoch}" > "${dedup_file}" 2>/dev/null || true

    # stdin에서 Stop 이벤트 데이터 읽기
    local stdin_data=""
    read -t 1 -r stdin_data 2>/dev/null || true

    # stop_reason 파싱
    local stop_reason="completed"
    if [ -n "${stdin_data}" ]; then
        if command -v jq >/dev/null 2>&1; then
            stop_reason=$(printf '%s' "${stdin_data}" | jq -r '.reason // "completed"' 2>/dev/null || echo "completed")
        else
            stop_reason=$(printf '%s' "${stdin_data}" | grep -o '"reason"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "completed")
        fi
    fi
    [ -z "${stop_reason}" ] && stop_reason="completed"

    # 프로젝트 경로 (CWD)
    local project_path
    project_path=$(pwd 2>/dev/null || echo "unknown")

    # DB 조회
    local db_path=""
    db_path=$(find_db 2>/dev/null || echo "")

    local start_time_str=""
    local elapsed_sec=0
    local files_count="0"
    local result_line=""

    if [ -n "${db_path}" ] && command -v sqlite3 >/dev/null 2>&1; then
        # prompt 시작 시각 (epoch) 조회
        local start_epoch
        start_epoch=$(sqlite3 "${db_path}" \
            "SELECT COALESCE(value,'0') FROM live_context WHERE key='messenger_prompt_time';" \
            2>/dev/null || echo "0")

        # 시작 시각 (사람이 읽을 수 있는 형태)
        if [ "${start_epoch}" -gt 0 ] 2>/dev/null; then
            start_time_str=$(date -r "${start_epoch}" "+%H:%M:%S" 2>/dev/null || echo "")
            local now_ts
            now_ts=$(date +%s 2>/dev/null || echo "0")
            elapsed_sec=$((now_ts - start_epoch))
        fi

        # 편집 파일 수: prompt 이후 tool_usage에서 Edit/Write 고유 파일 카운트
        if [ "${start_epoch}" -gt 0 ] 2>/dev/null && [ -n "${start_time_str}" ]; then
            local prompt_dt
            prompt_dt=$(date -r "${start_epoch}" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "")
            if [ -n "${prompt_dt}" ]; then
                files_count=$(sqlite3 "${db_path}" \
                    "SELECT COUNT(DISTINCT file_path) FROM tool_usage
                     WHERE tool_name IN ('Edit','Write')
                       AND file_path IS NOT NULL
                       AND timestamp >= '${prompt_dt}';" \
                    2>/dev/null || echo "0")
            fi
        fi

        # 결과내용: 여러 소스에서 순서대로 탐색
        # 1) current_task  2) key_findings  3) session_summary  4) 최근 편집 파일 목록
        result_line=$(sqlite3 "${db_path}" \
            "SELECT value FROM live_context WHERE key='current_task' AND value != '' LIMIT 1;" \
            2>/dev/null || echo "")
        if [ -z "${result_line}" ]; then
            result_line=$(sqlite3 "${db_path}" \
                "SELECT value FROM live_context WHERE key='key_findings' AND value != '' LIMIT 1;" \
                2>/dev/null || echo "")
        fi
        if [ -z "${result_line}" ]; then
            result_line=$(sqlite3 "${db_path}" \
                "SELECT value FROM live_context WHERE key='session_summary' AND value != '' LIMIT 1;" \
                2>/dev/null || echo "")
        fi
        if [ -z "${result_line}" ]; then
            # 최근 편집 파일 목록으로 대체
            local recent_files
            recent_files=$(sqlite3 "${db_path}" \
                "SELECT GROUP_CONCAT(DISTINCT REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '/', '')), ''), ', ')
                 FROM (SELECT file_path FROM tool_usage
                       WHERE tool_name IN ('Edit','Write') AND file_path IS NOT NULL
                       ORDER BY timestamp DESC LIMIT 5);" \
                2>/dev/null || echo "")
            if [ -n "${recent_files}" ]; then
                result_line="편집: ${recent_files}"
            fi
        fi
        # 첫 줄만 사용 + 80자 제한
        result_line=$(printf '%s' "${result_line}" | head -1 2>/dev/null || echo "")
        if [ ${#result_line} -gt 80 ]; then
            result_line="${result_line:0:77}..."
        fi
    fi

    # min_duration 체크: elapsed_sec < min_duration 이면 알림 스킵
    local min_dur="${MIN_DURATION:-0}"
    if [ "${min_dur}" -gt 0 ] 2>/dev/null && [ "${elapsed_sec}" -gt 0 ] 2>/dev/null; then
        if [ "${elapsed_sec}" -lt "${min_dur}" ]; then
            exit 0
        fi
    fi

    # scope 체크: project 모드이면 현재 프로젝트에 .messenger_enabled 파일 필요
    if ! check_scope "${SCOPE:-global}" 2>/dev/null; then
        exit 0
    fi

    # 시간 포맷
    local duration_str
    duration_str=$(format_duration "${elapsed_sec}")
    local end_time
    end_time=$(date "+%H:%M:%S" 2>/dev/null || echo "")
    [ -z "${start_time_str}" ] && start_time_str="${end_time}"

    # 결과내용: 없으면 기본 메시지
    [ -z "${result_line}" ] && result_line="작업 완료"

    # 메시지 조립
    local message="[dotclaude]
프로젝트: ${project_path}
상태: ${stop_reason}
시작: ${start_time_str}
종료: ${end_time}
소요: ${duration_str}
파일: ${files_count}개
결과: ${result_line}"

    # Telegram 전송 — 실패해도 exit 0
    send_telegram "${BOT_TOKEN}" "${CHAT_ID}" "${message}" >/dev/null 2>&1 || true
    exit 0
}

# ─── 서브커맨드: status ───
cmd_status() {
    echo ""
    printf "${BOLD}=== Telegram 메신저 설정 상태 ===${RESET}\n"
    echo ""

    if ! read_config 2>/dev/null; then
        warn "설정 파일 없음: ${CONFIG_FILE}"
        echo ""
        info "설정하려면: messenger.sh config <bot_token> <chat_id>"
        return 0
    fi

    local masked_token="(비어있음)"
    if [ -n "${BOT_TOKEN}" ]; then
        masked_token="${BOT_TOKEN:0:10}...(마스킹됨)"
    fi

    printf "  %-14s %s\n" "bot_token:" "${masked_token}"
    printf "  %-14s %s\n" "chat_id:" "${CHAT_ID:-'(비어있음)'}"
    printf "  %-14s " "enabled:"
    if [ "${ENABLED}" = "true" ]; then
        printf "${GREEN}활성화${RESET}\n"
    else
        printf "${YELLOW}비활성화${RESET}\n"
    fi
    local min_dur="${MIN_DURATION:-0}"
    if [ "${min_dur}" -gt 0 ] 2>/dev/null; then
        local human
        human=$(format_duration "${min_dur}")
        printf "  %-14s %s초 (%s)\n" "min_duration:" "${min_dur}" "${human}"
    else
        printf "  %-14s %s\n" "min_duration:" "제한 없음"
    fi
    printf "  %-14s %s\n" "scope:" "${SCOPE:-global}"
    printf "  %-14s %s\n" "설정 파일:" "${CONFIG_FILE}"
    echo ""
}

# ─── 메인 진입점 ───
SUBCOMMAND="${1:-}"

case "${SUBCOMMAND}" in
    config)
        shift
        cmd_config "$@"
        ;;
    test)
        cmd_test
        ;;
    on)
        cmd_on
        ;;
    off)
        cmd_off
        ;;
    send)
        shift
        cmd_send "$@"
        ;;
    status)
        cmd_status
        ;;
    notify)
        cmd_notify
        ;;
    set)
        shift
        cmd_set "$@"
        ;;
    get)
        shift
        cmd_get "$@"
        ;;
    prompt-time)
        # UserPromptSubmit hook에서 호출 — DB에 시작 epoch 저장
        _pt_db=$(find_db 2>/dev/null || echo "")
        if [ -n "${_pt_db}" ] && command -v sqlite3 >/dev/null 2>&1; then
            _pt_epoch=$(date +%s 2>/dev/null || echo "0")
            sqlite3 "${_pt_db}" \
                "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('messenger_prompt_time', '${_pt_epoch}', datetime('now','localtime'));" \
                2>/dev/null || true
        fi
        ;;
    ""|-h|--help|help)
        show_help
        ;;
    *)
        error "알 수 없는 서브커맨드: ${SUBCOMMAND}"
        show_help
        exit 1
        ;;
esac
