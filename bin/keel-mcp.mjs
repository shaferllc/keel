#!/usr/bin/env node
/**
 * Published entry for the Keel MCP server (`keel-mcp` bin).
 *
 *   npx -y keel-mcp                 # start the MCP server (stdio)
 *   npx -y keel-mcp@latest init     # write .mcp.json in this project
 */
const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === "init" || cmd === "install" || cmd === "setup") {
  const { runInstall } = await import("../dist/mcp/install.js");
  await runInstall(argv.slice(1)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else if (cmd === "--help" || cmd === "-h") {
  console.log(`
  keel-mcp                 Start the MCP server on stdio
  keel-mcp init [options]  Write .mcp.json (and optional Claude / Cursor config)

  Run \`keel-mcp init --help\` for install flags.
`);
} else {
  const { runMcpServer } = await import("../dist/mcp/server.js");
  await runMcpServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
