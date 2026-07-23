/**
 * `keel ui:fonts` — copy the kit's self-hosted webfonts into the app's public
 * directory, so `@import "@shaferllc/keel/ui/fonts"` resolves at runtime.
 *
 * The kit ships the .woff2 files but never links them: a framework has no
 * business adding a third-party request to every page, and a bundler cannot
 * rewrite a `url()` that points into node_modules into something a Worker will
 * serve. Copying is the honest fix, and it is one command.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { resolveKeelRoot } from "./kit-sync.js";

/** Where `@shaferllc/keel/ui/fonts` expects to find the files. */
export const DEFAULT_FONT_DIR = "public/fonts";

export interface FontCopyResult {
  /** Absolute directory the fonts were written to. */
  target: string;
  copied: string[];
  skipped: string[];
}

/** Locate the font files inside the installed package (or this repo). */
export function fontSourceDir(from = process.cwd()): string {
  try {
    const { root } = resolveKeelRoot(from);
    for (const candidate of [join(root, "dist/ui/fonts"), join(root, "src/ui/fonts")]) {
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Not installed as a dependency — fall through to the in-repo source.
  }
  const local = join(from, "src/ui/fonts");
  if (existsSync(local)) return local;
  throw new Error("Could not locate the Keel UI fonts — is @shaferllc/keel installed?");
}

export function copyUiFonts(options: {
  appRoot: string;
  dir?: string;
  force?: boolean;
}): FontCopyResult {
  const source = fontSourceDir(options.appRoot);
  const target = join(options.appRoot, options.dir ?? DEFAULT_FONT_DIR);
  mkdirSync(target, { recursive: true });

  const copied: string[] = [];
  const skipped: string[] = [];
  for (const file of readdirSync(source)) {
    if (!file.endsWith(".woff2") && file !== "OFL.txt") continue;
    const to = join(target, file);
    if (existsSync(to) && !options.force) {
      skipped.push(file);
      continue;
    }
    copyFileSync(join(source, file), to);
    copied.push(file);
  }
  return { target, copied, skipped };
}
