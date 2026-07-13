import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseInstallArgs, writeMcpConfig } from "../src/mcp/install.js";

test("parseInstallArgs understands --all and --token", () => {
  const opts = parseInstallArgs(["--all", "--token", "keel_x.y", "--cloud-url", "https://example.test"]);
  assert.equal(opts.cursor, true);
  assert.equal(opts.claude, true);
  assert.equal(opts.token, "keel_x.y");
  assert.equal(opts.cloudUrl, "https://example.test");
});

test("writeMcpConfig creates and merges .mcp.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "keel-mcp-init-"));
  try {
    const file = join(dir, ".mcp.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "echo" } } }));

    writeMcpConfig(file, { token: "keel_a.b" });
    const json = JSON.parse(readFileSync(file, "utf8"));

    assert.equal(json.mcpServers.other.command, "echo");
    assert.deepEqual(json.mcpServers.keel.command, "npx");
    assert.deepEqual(json.mcpServers.keel.args, ["-y", "--package=@shaferllc/keel", "keel-mcp"]);
    assert.equal(json.mcpServers.keel.env.KEEL_CLOUD_TOKEN, "keel_a.b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
