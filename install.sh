#!/usr/bin/env bash
# dotclaude installer — Oh My Zsh-style one-line install for Claude Code global settings
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/leonardo204/dotclaude/main/install.sh | bash
#   bash install.sh

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
REPO_URL="https://github.com/leonardo204/dotclaude.git"
BACKUP_BASE="${HOME}/.claude.pre-dotclaude"

# ─── Step 1: Check dependencies ───
info "Checking dependencies..."

if ! command -v git &>/dev/null; then
    error "git is required but not installed."
    error "Install git first: https://git-scm.com/downloads"
    exit 1
fi

ok "git found: $(git --version)"

# ─── Step 2: Backup existing ~/.claude/ ───
if [ -d "${DOTCLAUDE_DIR}" ]; then
    warn "Existing ~/.claude/ directory found."

    BACKUP_DIR="${BACKUP_BASE}"
    if [ -d "${BACKUP_DIR}" ]; then
        TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
        BACKUP_DIR="${BACKUP_BASE}.${TIMESTAMP}"
    fi

    info "Backing up to ${BACKUP_DIR}/ ..."
    cp -r "${DOTCLAUDE_DIR}" "${BACKUP_DIR}"
    ok "Backup complete: ${BACKUP_DIR}/"

    if [ -f "${DOTCLAUDE_DIR}/settings.json" ]; then
        warn "Existing settings.json detected in backup."
        warn "You may want to merge your custom settings after installation."
    fi
fi

# ─── Step 3: Clone repo to temp directory ───
TMPDIR_CLONE=$(mktemp -d)
trap 'rm -rf "${TMPDIR_CLONE}"' EXIT

info "Cloning dotclaude repository..."
git clone --depth 1 --quiet "${REPO_URL}" "${TMPDIR_CLONE}"
ok "Repository cloned."

# ─── Step 4: Install global files ───
info "Installing global settings to ~/.claude/ ..."
mkdir -p "${DOTCLAUDE_DIR}"
cp -r "${TMPDIR_CLONE}/global/"* "${DOTCLAUDE_DIR}/"
ok "Global files installed."

# ─── Step 5: Create marker file ───
INSTALL_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "${DOTCLAUDE_DIR}/.dotclaude-installed" <<EOF
installed_at=${INSTALL_DATE}
repo=${REPO_URL}
version=1.0.0
EOF
ok "Marker file created."

# ─── Done ───
echo ""
printf "${GREEN}${BOLD}dotclaude installed successfully!${RESET}\n"
echo ""

if [ -n "${BACKUP_DIR:-}" ]; then
    info "Your previous ~/.claude/ was backed up to:"
    echo "    ${BACKUP_DIR}/"
    echo ""
fi

echo "Next steps:"
echo "  1. cd your-project"
echo "  2. claude"
echo "  3. /dotclaude-init     (for new projects)"
echo "     /dotclaude-update    (for existing projects)"
echo ""
