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

# ─── Interactive confirmation ───
if [ "${FORCE}" = false ]; then
    echo ""
    warn "This will remove dotclaude global settings from ~/.claude/"
    echo ""
    echo "The following files will be deleted:"
    echo "  ~/.claude/CLAUDE.md"
    echo "  ~/.claude/settings.json"
    echo "  ~/.claude/MEMORY-example.md"
    echo "  ~/.claude/.dotclaude-installed"
    echo "  ~/.claude/commands/dotclaude-init.md"
    echo "  ~/.claude/commands/dotclaude-update.md"
    echo "  ~/.claude/scripts/context-monitor.mjs"
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

# ─── Remove dotclaude files (explicit list only) ───
info "Removing dotclaude files..."

DOTCLAUDE_FILES=(
    "${DOTCLAUDE_DIR}/CLAUDE.md"
    "${DOTCLAUDE_DIR}/settings.json"
    "${DOTCLAUDE_DIR}/MEMORY-example.md"
    "${DOTCLAUDE_DIR}/.dotclaude-installed"
    "${DOTCLAUDE_DIR}/commands/dotclaude-init.md"
    "${DOTCLAUDE_DIR}/commands/dotclaude-update.md"
    "${DOTCLAUDE_DIR}/scripts/context-monitor.mjs"
)

for f in "${DOTCLAUDE_FILES[@]}"; do
    if [ -f "${f}" ]; then
        rm -f "${f}"
        ok "Removed: ${f}"
    else
        info "Not found (skipped): ${f}"
    fi
done

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
