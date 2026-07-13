#!/usr/bin/env bash
# Install Keel's MCP server config in the current directory (or $1).
#
#   curl -fsSL https://keeljs.com/install.sh | bash
#   curl -fsSL https://keeljs.com/install.sh | bash -s -- --all
#   curl -fsSL https://keeljs.com/install.sh | bash -s -- /path/to/app --claude
#
set -euo pipefail

TARGET="."
DO_CURSOR=0
DO_CLAUDE=0
TOKEN=""
CLOUD_URL=""

usage() {
  cat <<'EOF'
Install Keel MCP config (.mcp.json) for Cursor / Claude Code / Windsurf.

Usage:
  curl -fsSL https://keeljs.com/install.sh | bash
  curl -fsSL https://keeljs.com/install.sh | bash -s -- --all
  curl -fsSL https://keeljs.com/install.sh | bash -s -- /path/to/app --claude

Flags:
  --cursor          also write .cursor/mcp.json
  --claude          register with Claude Code (claude mcp add …)
  --all             --cursor + --claude
  --token <keel_…>  set KEEL_CLOUD_TOKEN in the config env
  --cloud-url <url> set KEEL_CLOUD_URL
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --cursor) DO_CURSOR=1; shift ;;
    --claude) DO_CLAUDE=1; shift ;;
    --all) DO_CURSOR=1; DO_CLAUDE=1; shift ;;
    --token)
      TOKEN="${2:-}"
      [[ -n "$TOKEN" ]] || { echo "--token requires a value" >&2; exit 1; }
      shift 2
      ;;
    --token=*) TOKEN="${1#--token=}"; shift ;;
    --cloud-url)
      CLOUD_URL="${2:-}"
      [[ -n "$CLOUD_URL" ]] || { echo "--cloud-url requires a value" >&2; exit 1; }
      shift 2
      ;;
    --cloud-url=*) CLOUD_URL="${1#--cloud-url=}"; shift ;;
    -*)
      echo "Unknown flag: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      TARGET="$1"
      shift
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

write_mcp_json() {
  local file="$1"
  mkdir -p "$(dirname "$file")"

  if command -v node >/dev/null 2>&1; then
    MCP_FILE="$file" KEEL_TOKEN="$TOKEN" KEEL_CLOUD_URL="$CLOUD_URL" node --input-type=module <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const file = process.env.MCP_FILE;
let existing = {};
if (existsSync(file)) {
  try { existing = JSON.parse(readFileSync(file, "utf8")); } catch { existing = {}; }
}
const server = {
  command: "npx",
  args: ["-y", "--package=@shaferllc/keel", "keel-mcp"],
};
const env = {};
if (process.env.KEEL_TOKEN) env.KEEL_CLOUD_TOKEN = process.env.KEEL_TOKEN;
if (process.env.KEEL_CLOUD_URL) env.KEEL_CLOUD_URL = process.env.KEEL_CLOUD_URL;
if (Object.keys(env).length) server.env = env;
const next = {
  ...existing,
  mcpServers: { ...(existing.mcpServers ?? {}), keel: server },
};
writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
NODE
  else
    cat > "$file" <<'EOF'
{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "--package=@shaferllc/keel", "keel-mcp"]
    }
  }
}
EOF
  fi
  echo "  ✓ wrote $file"
}

write_mcp_json "$(pwd)/.mcp.json"
if [[ "$DO_CURSOR" == 1 ]]; then
  write_mcp_json "$(pwd)/.cursor/mcp.json"
fi

if [[ "$DO_CLAUDE" == 1 ]]; then
  if command -v claude >/dev/null 2>&1; then
    echo ""
    claude mcp add keel -- npx -y --package=@shaferllc/keel keel-mcp || true
    if [[ -n "$TOKEN" ]]; then
      echo "  Tip: export KEEL_CLOUD_TOKEN before starting Claude Code for Cloud tools."
    fi
  else
    echo "  (claude CLI not found — skipped --claude)"
  fi
fi

echo ""
echo "  Next:"
echo "    1. Restart your IDE / reload MCP servers."
echo "    2. Ask the agent to call keel_overview first."
echo ""
