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

# 미완료 태스크 수
PENDING_TASKS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tasks WHERE status IN ('pending','in_progress');" 2>/dev/null)

# 최근 결정사항
RECENT_DECISION=$(sqlite3 "$DB_PATH" "SELECT description FROM decisions ORDER BY id DESC LIMIT 1;" 2>/dev/null)

# 이번 세션 편집 파일 수
SESSION_EDITS=$(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID;" 2>/dev/null)

echo "[hook:on-prompt] DB 조회: 세션/태스크/결정/편집 현황"

# 컨텍스트 주입 (간결하게)
echo "[ctx] Session #$SESSION_ID | Edits: $SESSION_EDITS files | Pending tasks: $PENDING_TASKS"

if [ "$PENDING_TASKS" -gt 0 ] 2>/dev/null; then
    TASKS=$(sqlite3 "$DB_PATH" "SELECT '[P' || priority || '] ' || description FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority LIMIT 3;" 2>/dev/null)
    echo "[ctx] Tasks: $TASKS"
fi

if [ -n "$RECENT_DECISION" ]; then
    echo "[ctx] Last decision: $RECENT_DECISION"
fi

# DB 사용 리마인더 (컴팩션 이후에도 항상 보임)
echo "[ctx] DB: bash .claude/db/helper.sh <cmd> | 설계결정→decision-add, 에러→error-log, 태스크→task-add/done"

# === Context Monitor: compaction 감지 + live context 복구 ===
CTX_STATE="$PROJECT_ROOT/.claude/.ctx_state"
if [ -f "$CTX_STATE" ]; then
    CTX_CURRENT=$(grep -o '"current":[0-9]*' "$CTX_STATE" | grep -o '[0-9]*' 2>/dev/null)
    CTX_ALERT=$(grep -o '"alert":"[^"]*"' "$CTX_STATE" | cut -d'"' -f4 2>/dev/null)

    if [ "$CTX_ALERT" = "compacted" ]; then
        echo "[hook:on-prompt] DB 조회: live_context 복구 데이터"
        echo "[ctx-restore] Compaction detected. Restoring live context:"
        LIVE=$(sqlite3 "$DB_PATH" "SELECT '  - ' || key || ': ' || value FROM live_context ORDER BY key;" 2>/dev/null)
        if [ -n "$LIVE" ]; then
            echo "$LIVE"
        else
            echo "  (no live context saved)"
        fi
        echo "[ctx-restore] Review above and continue your work. Update live context with: bash .claude/db/helper.sh live-set <key> <value>"
        # Clear alert
        sed 's/"alert":"compacted"/"alert":"none"/' "$CTX_STATE" > "${CTX_STATE}.tmp" && mv "${CTX_STATE}.tmp" "$CTX_STATE"
    elif [ "$CTX_ALERT" = "high" ]; then
        echo "[ctx-warn] Context at ${CTX_CURRENT}%. Save state: bash .claude/db/helper.sh live-set current_task \"...\""
    fi
fi
