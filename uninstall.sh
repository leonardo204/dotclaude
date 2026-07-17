#!/usr/bin/env bash
# dotclaude uninstaller — removes only dotclaude-installed files, preserves user data
# Usage:
#   bash uninstall.sh              (interactive — prompts for confirmation)
#   bash uninstall.sh -y           (non-interactive — skip confirmation)
#   curl ... | bash -s -- -y       (pipe execution requires -y flag)

set -euo pipefail

# ─── Colors ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${BLUE}[info]${RESET}  %s\n" "$1"; }
warn()  { printf "${YELLOW}[warn]${RESET}  %s\n" "$1"; }
error() { printf "${RED}[error]${RESET} %s\n" "$1"; }
ok()    { printf "${GREEN}[ok]${RESET}    %s\n" "$1"; }

DOTCLAUDE_DIR="${HOME}/.claude"
FORCE=false

# ─── Parse flags ───
while [[ $# -gt 0 ]]; do
    case "$1" in
        -y|--yes) FORCE=true; shift ;;
        *) error "Unknown option: $1"; exit 1 ;;
    esac
done

# ─── Pipe detection: require -y for non-interactive ───
if [ ! -t 0 ] && [ "${FORCE}" = false ]; then
    error "Pipe execution detected without -y flag."
    error "For safety, pipe execution requires explicit confirmation:"
    echo  "  curl -fsSL <url>/uninstall.sh | bash -s -- -y"
    exit 1
fi

# ─── Check if dotclaude is installed ───
if [ ! -f "${DOTCLAUDE_DIR}/.dotclaude-installed" ]; then
    error "dotclaude does not appear to be installed (marker file not found)."
    error "Expected: ${DOTCLAUDE_DIR}/.dotclaude-installed"
    exit 1
fi

# ─── Deployment source detection: node + installed manifest (manifest-driven) ───
# 삭제 목록은 설치 시 배치된 resolved manifest 에서 파생한다. node 가 없으면
# 하드코딩 최소 폴백 목록으로 degrade 한다 (uninstall 은 삭제만 하므로 최악은 잔파일 — 안전).
APPLY_MANIFEST="${DOTCLAUDE_DIR}/bin/apply-manifest.mjs"
INSTALLED_MANIFEST="${DOTCLAUDE_DIR}/.dotclaude-manifest.json"
HAVE_NODE=false
if command -v node >/dev/null 2>&1 && [ -f "${APPLY_MANIFEST}" ] && [ -f "${INSTALLED_MANIFEST}" ]; then
    HAVE_NODE=true
fi

# 하드코딩 최소 폴백 목록 (node/manifest 부재 시에만 사용)
FALLBACK_FILES=(
    "${DOTCLAUDE_DIR}/CLAUDE.md"
    "${DOTCLAUDE_DIR}/settings.json"
    "${DOTCLAUDE_DIR}/MEMORY-example.md"
    "${DOTCLAUDE_DIR}/MEMORY.md"
    "${DOTCLAUDE_DIR}/.dotclaude-manifest.json"
    "${DOTCLAUDE_DIR}/messenger.json"
    "${DOTCLAUDE_DIR}/.hud_disabled"
    "${DOTCLAUDE_DIR}/scripts/context-monitor.mjs"
    "${DOTCLAUDE_DIR}/scripts/messenger.sh"
)
FALLBACK_DIRS=(
    "${DOTCLAUDE_DIR}/dist"
    "${DOTCLAUDE_DIR}/bin"
    "${DOTCLAUDE_DIR}/channels"
    "${DOTCLAUDE_DIR}/commands"
)

# ─── Interactive confirmation ───
if [ "${FORCE}" = false ]; then
    echo ""
    warn "This will remove dotclaude global settings from ~/.claude/"
    echo ""
    echo "The following will be deleted:"
    if [ "${HAVE_NODE}" = true ]; then
        node -e '
          const fs = require("fs");
          const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          const dest = process.argv[2];
          for (const e of m.entries || [])
            if (e.ownership === "harness" && (e.scope === "global" || e.scope === "both"))
              console.log("  " + dest + "/" + e.dest);
          for (const a of m.runtime_artifacts || [])
            if (a.scope === "global") console.log("  " + dest + "/" + a.path);
        ' "${INSTALLED_MANIFEST}" "${DOTCLAUDE_DIR}"
        echo "  ${DOTCLAUDE_DIR}/.dotclaude-installed"
    else
        for f in "${FALLBACK_FILES[@]}" "${FALLBACK_DIRS[@]}"; do echo "  ${f}"; done
        echo "  ${DOTCLAUDE_DIR}/.dotclaude-installed"
        warn "node/manifest 부재 — 하드코딩 폴백 목록으로 표시됨"
    fi
    echo ""
    echo "Any other files in ~/.claude/ will be preserved."
    echo ""

    printf "Continue? [y/N] "
    read -r answer
    case "${answer}" in
        [yY]|[yY][eE][sS]) ;;
        *) info "Uninstall cancelled."; exit 0 ;;
    esac
fi

# ─── Remove dotclaude files (manifest-driven, node fallback guard) ───
info "Removing dotclaude files..."

if [ "${HAVE_NODE}" = true ]; then
    node "${APPLY_MANIFEST}" --uninstall --dest "${DOTCLAUDE_DIR}" --manifest "${INSTALLED_MANIFEST}"
else
    warn "node 또는 manifest 없음 — 하드코딩 최소 폴백 목록으로 삭제합니다."
    for f in "${FALLBACK_FILES[@]}"; do
        if [ -e "${f}" ]; then rm -f "${f}"; ok "Removed: ${f}"; else info "Not found (skipped): ${f}"; fi
    done
    for d in "${FALLBACK_DIRS[@]}"; do
        if [ -d "${d}" ]; then rm -rf "${d}"; ok "Removed: ${d}/"; else info "Not found (skipped): ${d}/"; fi
    done
fi

# ─── Remove install marker (manifest 에 없는 스탬프 — 명시 삭제) ───
rm -f "${DOTCLAUDE_DIR}/.dotclaude-installed"
ok "Removed: ${DOTCLAUDE_DIR}/.dotclaude-installed"

# ─── Clean up empty directories ───
info "Cleaning up empty directories..."

for dir in "${DOTCLAUDE_DIR}/commands" "${DOTCLAUDE_DIR}/scripts" "${DOTCLAUDE_DIR}"; do
    if [ -d "${dir}" ]; then
        if rmdir "${dir}" 2>/dev/null; then
            ok "Removed empty directory: ${dir}"
        else
            info "Directory not empty (preserved): ${dir}"
        fi
    fi
done

# ─── Done ───
echo ""
printf "${GREEN}${BOLD}dotclaude uninstalled successfully!${RESET}\n"
echo ""

# ─── Backup restoration hint ───
BACKUP_BASE="${HOME}/.claude.pre-dotclaude"
if [ -d "${BACKUP_BASE}" ]; then
    echo "A backup of your previous ~/.claude/ was found:"
    echo "  ${BACKUP_BASE}/"
    echo ""
    echo "To restore it:"
    echo "  cp -r ${BACKUP_BASE}/* ~/.claude/"
    echo ""
fi
