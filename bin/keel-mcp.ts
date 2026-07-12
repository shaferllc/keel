#!/usr/bin/env tsx
// Dev entry for the Keel MCP server (runs from source via tsx).
// Consumers use the compiled `keel-mcp` bin (bin/keel-mcp.mjs) instead.
import { runMcpServer } from "../src/mcp/server.js";

runMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
