#!/usr/bin/env bash
# Install Keel's MCP server config in the current directory (or \$1).
#
#   curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash -s -- --all
#   curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash -s -- /path/to/app --claude
#
# Prefer this over hand-editing .mcp.json. Same result as: npx -y keel-mcp@latest init
set -euo pipefail

TARGET="."
ARGS=()

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      cat <<'EOF'
Install Keel MCP config (.mcp.json) for Cursor / Claude Code / Windsurf.

Usage:
  curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash
  curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash -s -- --all
  curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash -s -- /path/to/app --claude

Flags (passed through to keel-mcp init):
  --cursor   also write .cursor/mcp.json
  --claude   register with Claude Code
  --all      --cursor + --claude
  --token X  set KEEL_CLOUD_TOKEN
EOF
      exit 0
      ;;
    -*)
      ARGS+=("$arg")
      ;;
    *)
      if [[ "$TARGET" == "." && "$arg" != "." ]]; then
        TARGET="$arg"
      else
        ARGS+=("$arg")
      fi
      ;;
  esac
done

if [[ "$TARGET" != "." ]]; then
  mkdir -p "$TARGET"
  cd "$TARGET"
fi

echo ""
echo "  Installing Keel MCP in $(pwd)"
echo ""

if ! command -v npx >/dev/null 2>&1; then
  echo "  npx not found — need Node.js ≥ 22 (https://nodejs.org)." >&2
  exit 1
fi

# Prefer the published installer (writes / merges .mcp.json).
if npx -y keel-mcp@latest init --cwd "$(pwd)" "${ARGS[@]+"${ARGS[@]}"}"; then
  exit 0
fi

# Fallback: write a minimal .mcp.json if npx init is unavailable.
echo "  keel-mcp init failed — writing a minimal .mcp.json instead."
export MCP_FILE="$(pwd)/.mcp.json"
if [[ -f "$MCP_FILE" ]]; then
  if command -v node >/dev/null 2>&1; then
    node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.MCP_FILE;
const existing = JSON.parse(readFileSync(file, "utf8"));
existing.mcpServers = {
  ...(existing.mcpServers ?? {}),
  keel: { command: "npx", args: ["-y", "keel-mcp"] },
};
writeFileSync(file, JSON.stringify(existing, null, 2) + "\n");
NODE
  else
    echo "  Refusing to clobber existing .mcp.json without node. Aborting." >&2
    exit 1
  fi
else
  cat > "$MCP_FILE" <<'EOF'
{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "keel-mcp"]
    }
  }
}
EOF
fi

echo "  ✓ wrote $MCP_FILE"
echo ""
echo "  Restart your IDE / MCP client, then call keel_overview."
echo ""
