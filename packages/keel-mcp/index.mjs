#!/usr/bin/env node
/**
 * Thin published bin so `npx -y keel-mcp` resolves on the registry.
 * The real server lives on `@shaferllc/keel` (`bin/keel-mcp.mjs`).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const keelRoot = dirname(require.resolve("@shaferllc/keel/package.json"));
const bin = join(keelRoot, "bin", "keel-mcp.mjs");

const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
