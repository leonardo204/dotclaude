#!/bin/bash
# UserPromptSubmit Hook: 매 프롬프트마다 SQLite 컨텍스트 요약 주입
# 컨텍스트 컴팩션과 무관하게 항상 실행됨

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"
HELPER="$PROJECT_ROOT/.claude/db/helper.sh"

[ ! -f "$DB_PATH" ] && exit 0

# 축적된 hook 피드백 출력 (PostToolUse/Stop stdout은 verbose 모드에서만 보이므로 여기서 릴레이)
FEEDBACK_FILE="$PROJECT_ROOT/.claude/.hook_feedback"
if [ -f "$FEEDBACK_FILE" ] && [ -s "$FEEDBACK_FILE" ]; then
    echo "[hook-feedback] 지난 턴 이후 DB 활동:"
    cat "$FEEDBACK_FILE"
    rm -f "$FEEDBACK_FILE"
fi

# 현재 세션 ID
SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM sessions ORDER BY id DESC LIMIT 1;" 2>/dev/null)

# === Context Monitor: 상황 판단 (3단계 차등 주입) ===
CTX_STATE="$PROJECT_ROOT/.claude/.ctx_state"
CTX_ALERT="none"

if [ -f "$CTX_STATE" ]; then
    CTX_CURRENT=$(grep -o '"current":[0-9]*' "$CTX_STATE" | grep -o '[0-9]*' 2>/dev/null)
    CTX_ALERT=$(grep -o '"alert":"[^"]*"' "$CTX_STATE" | cut -d'"' -f4 2>/dev/null)
fi

if [ "$CTX_ALERT" = "compacted" ]; then
    # === 최대 복구 모드 ===
    echo "[hook:on-prompt] DB 조회: compaction 복구 (최대 모드)"
    echo "[ctx-restore] Compaction detected. Restoring full context:"

    # live_context 전체 dump
    LIVE=$(sqlite3 "$DB_PATH" "SELECT '  - ' || key || ': ' || value FROM live_context ORDER BY key;" 2>/dev/null)
    if [ -n "$LIVE" ]; then
        echo "$LIVE"
    else
        echo "  (no live context saved)"
    fi

    # 최근 decisions 5건
    DECISIONS=$(sqlite3 "$DB_PATH" "SELECT '  - ' || description FROM decisions ORDER BY id DESC LIMIT 5;" 2>/dev/null)
    if [ -n "$DECISIONS" ]; then
        echo "[ctx-restore] Recent decisions:"
        echo "$DECISIONS"
    fi

    # pending tasks 상세
    PENDING_TASKS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tasks WHERE status IN ('pending','in_progress');" 2>/dev/null)
    if [ "$PENDING_TASKS" -gt 0 ] 2>/dev/null; then
        TASKS=$(sqlite3 "$DB_PATH" "SELECT '  - [P' || priority || '][' || status || '] ' || description FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority;" 2>/dev/null)
        echo "[ctx-restore] Pending tasks ($PENDING_TASKS):"
        echo "$TASKS"
    fi

    # 최근 errors 3건
    ERRORS=$(sqlite3 "$DB_PATH" "SELECT '  - ' || error_type || ': ' || COALESCE(file_path,'') || ' (' || timestamp || ')' FROM errors ORDER BY id DESC LIMIT 3;" 2>/dev/null)
    if [ -n "$ERRORS" ]; then
        echo "[ctx-restore] Recent errors:"
        echo "$ERRORS"
    fi

    echo "[ctx-restore] Review above and continue your work."

    # alert 클리어
    sed 's/"alert":"compacted"/"alert":"none"/' "$CTX_STATE" > "${CTX_STATE}.tmp" && mv "${CTX_STATE}.tmp" "$CTX_STATE"

elif [ "$CTX_ALERT" = "high" ]; then
    # === 경고 모드 ===
    echo "[ctx-warn] Context at ${CTX_CURRENT}%. live-set으로 상태 저장 권장"

else
    # === 기본 모드 (최소 주입) ===
    SESSION_EDITS=$(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID;" 2>/dev/null)
    PENDING_TASKS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tasks WHERE status IN ('pending','in_progress');" 2>/dev/null)

    echo "[ctx] Session #$SESSION_ID | Edits: $SESSION_EDITS files | Pending tasks: $PENDING_TASKS"
    echo "[ctx] DB: bash .claude/db/helper.sh <cmd> | live-set/append, decision-add, task-add/done"
fi
