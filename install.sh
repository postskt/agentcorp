#!/usr/bin/env bash
# AgentCorp one-command installer.
# Usage:
#   bash install.sh dsh          # install as a native DSH plugin (via plugin manager)
#   bash install.sh zcode        # install skill into ~/.zcode/skills
#   bash install.sh workbuddy    # install skill into ~/.workbuddy/skills
#   bash install.sh antigravity  # install plugin into ~/.gemini/config/plugins
#   bash install.sh all          # all of the above
#
# The install is done by this shell script directly — no AI, no model tokens.

set -e
REPO="https://github.com/postskt/agentcorp.git"
TARGET="${1:-all}"
HOME_DIR="${HOME:-$USERPROFILE}"

# Resolve the shared hub: next drive after C: on Windows, else ~/agent-link.
hub_root() {
  if [ -n "$AGENTCORP_HUB_ROOT" ]; then echo "$AGENTCORP_HUB_ROOT"; return; fi
  if [ -d "E:/" ]; then echo "E:/agent-link";
  elif [ -d "F:/" ]; then echo "F:/agent-link";
  elif [ -d "D:/" ]; then echo "D:/agent-link";
  else echo "$HOME_DIR/agent-link"; fi
}

install_dsh() {
  echo "[DSH] Installing native plugin..."
  if command -v dsh >/dev/null 2>&1; then
    dsh plugin --profile web add github:postskt/agentcorp
    echo "[DSH] Done. Restart DSH; the plugin appears in Plugins page."
  else
    echo "[DSH] No 'dsh' command on PATH (desktop build bundles it internally)."
    echo "[DSH] Please install via the UI: Plugins -> Add plugin -> github:postskt/agentcorp -> Install"
  fi
}

install_skill() {
  local platform="$1" dest="$2"
  echo "[$platform] Installing AgentCorp skill -> $dest"
  mkdir -p "$dest"
  mkdir -p "$HOME_DIR/.agentcorp-cache"
  if [ ! -d "$HOME_DIR/.agentcorp-cache/agentcorp/.git" ]; then
    git clone -q --depth 1 "$REPO" "$HOME_DIR/.agentcorp-cache/agentcorp" 2>/dev/null \
      || { echo "git clone failed; use the DSH plugin manager or manual copy."; return 1; }
  fi
  cp -r "$HOME_DIR/.agentcorp-cache/agentcorp/integrations/$platform/skills/agentcorp" "$dest/" 2>/dev/null || true
  echo "[$platform] Skill installed."
}

install_antigravity() {
  local dest="$HOME_DIR/.gemini/config/plugins/agentcorp-plugin"
  echo "[Antigravity] Installing plugin -> $dest"
  mkdir -p "$dest/skills"
  mkdir -p "$HOME_DIR/.agentcorp-cache"
  if [ ! -d "$HOME_DIR/.agentcorp-cache/agentcorp/.git" ]; then
    git clone -q --depth 1 "$REPO" "$HOME_DIR/.agentcorp-cache/agentcorp" 2>/dev/null || true
  fi
  cp -r "$HOME_DIR/.agentcorp-cache/agentcorp/integrations/antigravity/skills/agentcorp" "$dest/skills/" 2>/dev/null || true
  cp "$HOME_DIR/.agentcorp-cache/agentcorp/integrations/antigravity/plugin.json" "$dest/plugin.json" 2>/dev/null || true
  echo "[Antigravity] Plugin installed."
}

case "$TARGET" in
  dsh)         install_dsh ;;
  zcode)       install_skill zcode "$HOME_DIR/.zcode/skills" ;;
  workbuddy)   install_skill workbuddy "$HOME_DIR/.workbuddy/skills" ;;
  antigravity) install_antigravity ;;
  all)         install_dsh; install_skill zcode "$HOME_DIR/.zcode/skills"; install_skill workbuddy "$HOME_DIR/.workbuddy/skills"; install_antigravity ;;
  *) echo "Unknown target: $TARGET"; echo "Use: dsh|zcode|workbuddy|antigravity|all"; exit 1 ;;
esac

echo ""
echo "Shared hub will be: $(hub_root)"
echo "After install, restart each agent and call agent_hello to appear online."
