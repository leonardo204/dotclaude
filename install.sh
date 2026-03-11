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

# Detect OS and package manager
OS="$(uname)"
PKG_MGR=""
if [[ "${OS}" == "Darwin" ]]; then
    command -v brew &>/dev/null && PKG_MGR="brew"
elif command -v apt-get &>/dev/null; then
    PKG_MGR="apt"
elif command -v yum &>/dev/null; then
    PKG_MGR="yum"
elif command -v pacman &>/dev/null; then
    PKG_MGR="pacman"
elif command -v apk &>/dev/null; then
    PKG_MGR="apk"
fi

# Helper: install a package via detected package manager
pkg_install() {
    local pkg="$1"
    local apt_pkg="${2:-$1}"
    local brew_pkg="${3:-$1}"

    case "${PKG_MGR}" in
        brew)   brew install "${brew_pkg}" ;;
        apt)    sudo apt-get update -qq && sudo apt-get install -y -qq "${apt_pkg}" ;;
        yum)    sudo yum install -y "${apt_pkg}" ;;
        pacman) sudo pacman -S --noconfirm "${apt_pkg}" ;;
        apk)    sudo apk add "${apt_pkg}" ;;
        *)
            error "No supported package manager found. Install '${pkg}' manually."
            exit 1
            ;;
    esac
}

# Helper: add a path to shell profile if not already present
ensure_in_path() {
    local dir="$1"
    if [[ ":${PATH}:" != *":${dir}:"* ]]; then
        export PATH="${dir}:${PATH}"
        # Persist to shell profile
        local profile=""
        if [ -f "${HOME}/.zshrc" ]; then
            profile="${HOME}/.zshrc"
        elif [ -f "${HOME}/.bashrc" ]; then
            profile="${HOME}/.bashrc"
        elif [ -f "${HOME}/.profile" ]; then
            profile="${HOME}/.profile"
        fi
        if [ -n "${profile}" ]; then
            if ! grep -qF "${dir}" "${profile}" 2>/dev/null; then
                echo "" >> "${profile}"
                echo "# Added by dotclaude installer" >> "${profile}"
                echo "export PATH=\"${dir}:\${PATH}\"" >> "${profile}"
                info "Added ${dir} to PATH in ${profile}"
            fi
        fi
    fi
}

# --- git ---
if ! command -v git &>/dev/null; then
    error "git is required but not installed."
    error "Install git first: https://git-scm.com/downloads"
    exit 1
fi
ok "git found: $(git --version)"

# --- sqlite3 ---
if ! command -v sqlite3 &>/dev/null; then
    warn "sqlite3 not found. Installing..."
    pkg_install sqlite3 sqlite3 sqlite3
    # Homebrew sqlite3 is keg-only on macOS — add to PATH
    if [[ "${OS}" == "Darwin" ]] && [[ "${PKG_MGR}" == "brew" ]]; then
        SQLITE_PREFIX="$(brew --prefix sqlite3 2>/dev/null || true)"
        if [ -n "${SQLITE_PREFIX}" ] && [ -d "${SQLITE_PREFIX}/bin" ]; then
            ensure_in_path "${SQLITE_PREFIX}/bin"
        fi
    fi
    if ! command -v sqlite3 &>/dev/null; then
        error "sqlite3 installation failed."
        exit 1
    fi
    ok "sqlite3 installed successfully."
fi
ok "sqlite3 found: $(sqlite3 --version | cut -d' ' -f1)"

# --- node ---
if ! command -v node &>/dev/null; then
    warn "Node.js not found. Installing..."
    if [[ "${OS}" == "Darwin" ]] && [[ "${PKG_MGR}" == "brew" ]]; then
        brew install node
    elif [[ "${PKG_MGR}" == "apt" ]]; then
        # Use NodeSource LTS for a recent version
        if ! command -v curl &>/dev/null; then
            sudo apt-get update -qq && sudo apt-get install -y -qq curl
        fi
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y -qq nodejs
    elif [[ "${PKG_MGR}" == "yum" ]]; then
        if ! command -v curl &>/dev/null; then
            sudo yum install -y curl
        fi
        curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
        sudo yum install -y nodejs
    elif [[ "${PKG_MGR}" == "pacman" ]]; then
        sudo pacman -S --noconfirm nodejs npm
    elif [[ "${PKG_MGR}" == "apk" ]]; then
        sudo apk add nodejs npm
    else
        error "No supported package manager found. Install Node.js manually: https://nodejs.org"
        exit 1
    fi
    # Ensure node is in PATH (brew on macOS)
    if [[ "${OS}" == "Darwin" ]] && [[ "${PKG_MGR}" == "brew" ]]; then
        NODE_PREFIX="$(brew --prefix node 2>/dev/null || true)"
        if [ -n "${NODE_PREFIX}" ] && [ -d "${NODE_PREFIX}/bin" ]; then
            ensure_in_path "${NODE_PREFIX}/bin"
        fi
    fi
    if ! command -v node &>/dev/null; then
        error "Node.js installation failed."
        exit 1
    fi
    ok "Node.js installed successfully."
fi
ok "node found: $(node --version)"

# --- node version check (>= 22 required) ---
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "${NODE_MAJOR}" -lt 22 ]; then
    error "Node.js >= 22 required (found: $(node -v))."
    error "Please upgrade Node.js: https://nodejs.org"
    exit 1
fi
ok "Node.js version check passed (>= 22)."

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

# ─── Step 4a: Install dist/ files from project-local ───
info "Installing dist/ bridge and HUD files..."
if [ ! -d "${TMPDIR_CLONE}/project-local/dist" ]; then
  error "dist/ not found in repo. Build required before release."
  exit 1
fi
mkdir -p "${DOTCLAUDE_DIR}/dist/hooks" "${DOTCLAUDE_DIR}/dist/hud" "${DOTCLAUDE_DIR}/dist/mcp"
cp -r "${TMPDIR_CLONE}/project-local/dist/"* "${DOTCLAUDE_DIR}/dist/"
ok "dist/ files installed."

# ─── Step 4b: HUD scope selection ───
echo ""
printf "${BOLD}StatusLine HUD 설치 범위를 선택하세요:${RESET}\n"
echo "  1) Global  — 모든 프로젝트에서 HUD 표시 (기본)"
echo "  2) Project — dotclaude-init한 프로젝트에서만 HUD 표시"
echo "  3) Skip    — HUD 설치 안 함"
echo ""
printf "선택 [1/2/3] (기본: 1): "
read -r HUD_CHOICE </dev/tty 2>/dev/null || HUD_CHOICE="1"
HUD_CHOICE="${HUD_CHOICE:-1}"

case "${HUD_CHOICE}" in
    2)
        info "HUD를 프로젝트-로컬 전용으로 설정합니다..."
        # global settings.json에서 statusLine 키 제거
        node -e "
          const fs = require('fs');
          const p = '${DOTCLAUDE_DIR}/settings.json';
          const s = JSON.parse(fs.readFileSync(p, 'utf8'));
          delete s.statusLine;
          fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
        "
        ok "HUD: 프로젝트-로컬 전용 (dotclaude-init 시 프로젝트별 설정)"
        ;;
    3)
        info "HUD 설치를 건너뜁니다..."
        node -e "
          const fs = require('fs');
          const p = '${DOTCLAUDE_DIR}/settings.json';
          const s = JSON.parse(fs.readFileSync(p, 'utf8'));
          delete s.statusLine;
          fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
        "
        # HUD disabled 플래그 생성
        touch "${DOTCLAUDE_DIR}/.hud_disabled"
        ok "HUD: 건너뜀 (/dotclaude-statusline on 으로 활성화 가능)"
        ;;
    *)
        ok "HUD: 글로벌 (모든 프로젝트에서 표시)"
        ;;
esac

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
