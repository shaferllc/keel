/**
 * `keel kit:sync` — refresh an app from the starter kit shipped inside
 * `@shaferllc/keel`, without clobbering files you've customized.
 *
 * create-keeljs writes `.keel/kit.json` with content hashes at generation time.
 * Sync overwrites a path only when:
 *   - the file is missing (new kit file), or
 *   - its hash still matches the recorded one (never edited), or
 *   - `--force` is set (opt-in overwrite of customized files).
 *
 * `.env` is never written (secrets). `package-lock.json` is never written.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

import type { Ui } from "../console-ui.js";

export const PRESETS = ["minimal", "api", "app", "saas"] as const;
export type KitPreset = (typeof PRESETS)[number];

export interface KitLock {
  preset: KitPreset;
  /** Framework version the kit was last synced from. */
  version: string;
  /** Relative path → sha256 of the file contents as last written by the kit. */
  files: Record<string, string>;
}

const SKIP_WRITE = new Set([".env", "package-lock.json"]);
const SKIP_WALK = new Set(["node_modules", ".git", ".keel"]);

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function resolveKeelRoot(from = process.cwd()): { root: string; version: string } {
  const require = createRequire(join(from, "noop.js"));
  const pkgPath = require.resolve("@shaferllc/keel/package.json");
  const version = JSON.parse(readFileSync(pkgPath, "utf8")).version as string;
  return { root: dirname(pkgPath), version };
}

export function walkFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (SKIP_WALK.has(entry)) return [];
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walkFiles(full) : [full];
  });
}

export function readKitLock(appRoot: string): KitLock | null {
  const path = join(appRoot, ".keel", "kit.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as KitLock;
}

export function writeKitLock(appRoot: string, lock: KitLock): void {
  const dir = join(appRoot, ".keel");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "kit.json"), `${JSON.stringify(lock, null, 2)}\n`);
}

function appNameFrom(appRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { name?: string };
    return pkg.name ?? "keel-app";
  } catch {
    return "keel-app";
  }
}

/** Fill the same placeholders create-keeljs fills. */
export function materialize(text: string, appName: string, version: string): string {
  return text.split("__APP_NAME__").join(appName).split("__KEEL_VERSION__").join(`^${version}`);
}

export interface KitSyncOptions {
  appRoot: string;
  preset: KitPreset;
  force?: boolean;
  dryRun?: boolean;
  ui: Ui;
}

export interface KitSyncResult {
  added: string[];
  updated: string[];
  skipped: string[];
  unchanged: string[];
}

export function syncKit(options: KitSyncOptions): KitSyncResult {
  const { appRoot, preset, force = false, dryRun = false, ui } = options;
  const { root: keelRoot, version } = resolveKeelRoot(appRoot);
  const source = join(keelRoot, "templates", preset);
  if (!existsSync(source)) {
    throw new Error(`@shaferllc/keel@${version} ships no "${preset}" template.`);
  }

  const appName = appNameFrom(appRoot);
  const lock = readKitLock(appRoot);
  const nextFiles: Record<string, string> = {};
  const result: KitSyncResult = { added: [], updated: [], skipped: [], unchanged: [] };

  if (!lock && !force) {
    ui.info("No .keel/kit.json — only missing files will be added (use --force to overwrite).");
  }

  for (const abs of walkFiles(source)) {
    const rel = relative(source, abs).replace(/\\/g, "/");
    if (SKIP_WRITE.has(rel)) continue;

    const desired = materialize(readFileSync(abs, "utf8"), appName, version);
    const desiredHash = hashText(desired);
    nextFiles[rel] = desiredHash;

    const dest = join(appRoot, rel);
    const exists = existsSync(dest);

    if (!exists) {
      result.added.push(rel);
      if (!dryRun) {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, desired);
      }
      ui.action(dryRun ? "would add" : "add", rel);
      continue;
    }

    const current = readFileSync(dest, "utf8");
    const currentHash = hashText(current);

    if (currentHash === desiredHash) {
      result.unchanged.push(rel);
      continue;
    }

    const recorded = lock?.files[rel];
    const untouched = recorded != null && recorded === currentHash;

    if (force || untouched) {
      result.updated.push(rel);
      if (!dryRun) writeFileSync(dest, desired);
      ui.action(dryRun ? "would update" : "update", rel);
      continue;
    }

    result.skipped.push(rel);
    ui.action("skip", `${rel} (customized)`);
  }

  // .env.example may have been updated — copy to .env only when .env is missing.
  const envExample = join(appRoot, ".env.example");
  const envPath = join(appRoot, ".env");
  if (existsSync(envExample) && !existsSync(envPath)) {
    if (!dryRun) cpSync(envExample, envPath);
    ui.action(dryRun ? "would add" : "add", ".env");
    result.added.push(".env");
  }

  if (!dryRun) {
    writeKitLock(appRoot, { preset, version, files: nextFiles });
    ui.action("write", ".keel/kit.json");
  }

  return result;
}
