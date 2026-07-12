#!/usr/bin/env node
// Published entry for the Keel MCP server. Registered as the `keel-mcp` bin,
// so an installed app can wire it up with `npx keel-mcp` (see docs/ai.md).
import { runMcpServer } from "../dist/mcp/server.js";

runMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
