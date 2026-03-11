#!/bin/bash
# UserPromptSubmit Hook: 매 프롬프트마다 SQLite 컨텍스트 요약 주입
# 컨텍스트 컴팩션과 무관하게 항상 실행됨

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="$PROJECT_ROOT/.claude/db/context.db"

[ ! -f "$DB_PATH" ] && exit 0

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
    # 중복 복구 방지: 이미 복구했으면 스킵
    CTX_RESTORED_AT=$(grep -o '"restored_at":"[^"]*"' "$CTX_STATE" 2>/dev/null | cut -d'"' -f4)
    CTX_UPDATED=$(grep -o '"updated":"[^"]*"' "$CTX_STATE" 2>/dev/null | cut -d'"' -f4)
    if [ -n "$CTX_RESTORED_AT" ] && [ "$CTX_RESTORED_AT" = "$CTX_UPDATED" ]; then
        # 이미 이 compaction에 대해 복구 완료 — 기본 모드로 전환
        echo '{"current":'"${CTX_CURRENT:-0}"',"previous":0,"peak":'"${CTX_CURRENT:-0}"',"alert":"none","updated":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' > "$CTX_STATE"
        read SESSION_EDITS PENDING_TASKS <<< $(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID; SELECT COUNT(*) FROM tasks WHERE status IN ('pending','in_progress');" 2>/dev/null | tr '\n' ' ')
        echo "[ctx] Session #$SESSION_ID | Edits: $SESSION_EDITS files | Pending tasks: $PENDING_TASKS"
        echo "[rules] 한국어 · verify · agent≥3 · live-set · no-commit"
    else
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

        # alert 클리어 — 직접 파일 덮어쓰기 (sed 대신 안정적)
        RESTORE_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        echo '{"current":'"${CTX_CURRENT:-0}"',"previous":0,"peak":'"${CTX_CURRENT:-0}"',"alert":"none","restored_at":"'"$RESTORE_TS"'","updated":"'"$CTX_UPDATED"'"}' > "$CTX_STATE"
    fi

elif [ "$CTX_ALERT" = "high" ]; then
    # === 경고 모드: 핵심 상태 자동 저장 ===
    WORKING=$(sqlite3 "$DB_PATH" "SELECT DISTINCT file_path FROM tool_usage WHERE session_id=$SESSION_ID ORDER BY id DESC LIMIT 20;" 2>/dev/null)
    if [ -n "$WORKING" ]; then
        WORKING_ESC="${WORKING//\'/\'\'}"
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO live_context (key, value, updated_at) VALUES ('working_files', '$WORKING_ESC', datetime('now','localtime'));" 2>/dev/null
    fi
    echo "[ctx-warn] Context at ${CTX_CURRENT}%. 핵심 상태 자동 저장 완료. live-set으로 추가 저장 권장"

else
    # === 기본 모드 (최소 주입) ===
    read SESSION_EDITS PENDING_TASKS <<< $(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT file_path) FROM tool_usage WHERE session_id=$SESSION_ID; SELECT COUNT(*) FROM tasks WHERE status IN ('pending','in_progress');" 2>/dev/null | tr '\n' ' ')

    echo "[ctx] Session #$SESSION_ID | Edits: $SESSION_EDITS files | Pending tasks: $PENDING_TASKS"
    echo "[rules] 한국어 · verify · agent≥3 · live-set · no-commit"
fi
