/**
 * `npx -y keel-mcp init` — drop Keel's MCP config into the current project.
 *
 * Writes (or merges) `.mcp.json` so Cursor / Windsurf / other clients pick up
 * the server without hand-editing JSON. Optionally registers Claude Code too.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SERVER = {
  command: "npx",
  // Prefer the published `keel-mcp` package when available; otherwise pin the
  // package that ships the bin so Cursor doesn't 404 on a bare `keel-mcp` name.
  args: ["-y", "--package=@shaferllc/keel", "keel-mcp"],
} as const;

export type InstallOptions = {
  /** Working directory (default: cwd). */
  cwd?: string;
  /** Also write `.cursor/mcp.json`. */
  cursor?: boolean;
  /** Run `claude mcp add keel -- npx -y keel-mcp` when `claude` is on PATH. */
  claude?: boolean;
  /** Merge `KEEL_CLOUD_TOKEN` (and optional URL) into the server env. */
  token?: string;
  cloudUrl?: string;
  /** Print help and exit. */
  help?: boolean;
};

export function parseInstallArgs(argv: string[]): InstallOptions {
  const opts: InstallOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--cursor") opts.cursor = true;
    else if (arg === "--claude") opts.claude = true;
    else if (arg === "--all") {
      opts.cursor = true;
      opts.claude = true;
    } else if (arg === "--token") opts.token = argv[++i];
    else if (arg.startsWith("--token=")) opts.token = arg.slice("--token=".length);
    else if (arg === "--cloud-url") opts.cloudUrl = argv[++i];
    else if (arg.startsWith("--cloud-url=")) opts.cloudUrl = arg.slice("--cloud-url=".length);
    else if (arg === "--cwd") opts.cwd = argv[++i];
    else if (arg.startsWith("--cwd=")) opts.cwd = arg.slice("--cwd=".length);
  }
  return opts;
}

export function printInstallHelp(): void {
  console.log(`
  curl -fsSL https://keeljs.com/install.sh | bash

  Or via npm:

    npx -y keel-mcp@latest init [options]
    # or: npx -y --package=@shaferllc/keel keel-mcp init

  Write Keel's MCP server into this project so Cursor / Claude Code / Windsurf
  can call keel_overview, search docs, scaffold stubs, and (with a token) deploy
  to *.keeljs.cloud.

  Options:
    --cursor          also write .cursor/mcp.json
    --claude          register with Claude Code (claude mcp add …)
    --all             --cursor + --claude
    --token <keel_…>  set KEEL_CLOUD_TOKEN in the config env
    --cloud-url <url> override KEEL_CLOUD_URL (default production)
    --cwd <dir>       project directory (default: current)
    -h, --help        this help

  Examples:
    curl -fsSL https://keeljs.com/install.sh | bash
    npx -y keel-mcp@latest init --all
    npx -y --package=@shaferllc/keel keel-mcp init --token keel_xxxx.yyyy --claude
`);
}

/** Merge the Keel server entry into an MCP config file; returns the path written. */
export function writeMcpConfig(file: string, options: InstallOptions = {}): string {
  const absolute = resolve(file);
  mkdirSync(dirname(absolute), { recursive: true });

  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(absolute)) {
    try {
      existing = JSON.parse(readFileSync(absolute, "utf8")) as typeof existing;
    } catch {
      throw new Error(`${absolute} exists but isn't valid JSON.`);
    }
  }

  const server: Record<string, unknown> = {
    command: SERVER.command,
    args: [...SERVER.args],
  };

  const env: Record<string, string> = {};
  if (options.token) env.KEEL_CLOUD_TOKEN = options.token;
  if (options.cloudUrl) env.KEEL_CLOUD_URL = options.cloudUrl;
  if (Object.keys(env).length) server.env = env;

  const next = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      keel: server,
    },
  };

  writeFileSync(absolute, `${JSON.stringify(next, null, 2)}\n`);
  return absolute;
}

export function runClaudeMcpAdd(options: InstallOptions = {}): boolean {
  const claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (claude.status !== 0) {
    console.log("  (claude CLI not found — skipped; install Claude Code to use --claude)");
    return false;
  }

  const args = ["mcp", "add", "keel", "--", "npx", "-y", "--package=@shaferllc/keel", "keel-mcp"];
  if (options.token) {
    // Claude Code picks up env from the shell; remind the user.
    console.log("  Tip: export KEEL_CLOUD_TOKEN before starting Claude Code for Cloud tools.");
  }

  const result = spawnSync("claude", args, { stdio: "inherit" });
  return result.status === 0;
}

export async function runInstall(argv: string[]): Promise<void> {
  const opts = parseInstallArgs(argv);
  if (opts.help) {
    printInstallHelp();
    return;
  }

  const cwd = resolve(opts.cwd ?? process.cwd());
  console.log(`\n  Installing Keel MCP in ${cwd}\n`);

  const written: string[] = [];
  written.push(writeMcpConfig(join(cwd, ".mcp.json"), opts));
  if (opts.cursor) {
    written.push(writeMcpConfig(join(cwd, ".cursor", "mcp.json"), opts));
  }

  for (const path of written) {
    console.log(`  ✓ wrote ${path}`);
  }

  if (opts.claude) {
    console.log("");
    if (runClaudeMcpAdd(opts)) console.log("  ✓ registered with Claude Code");
  }

  console.log(`
  Next:
    1. Restart your IDE / MCP client (or reload MCP servers).
    2. Ask the agent to call keel_overview first.

  Cloud deploy (optional):
    export KEEL_CLOUD_TOKEN=keel_….…
    curl -fsSL https://keeljs.com/install.sh | bash -s -- --token "\$KEEL_CLOUD_TOKEN" --claude
`);
}
