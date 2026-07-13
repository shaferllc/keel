import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createUi } from "../src/core/console-ui.js";
import {
  hashText,
  materialize,
  syncKit,
  writeKitLock,
  readKitLock,
} from "../src/core/cli/kit-sync.js";

test("materialize fills app name and keel version placeholders", () => {
  assert.equal(
    materialize('name: "__APP_NAME__", dep: "__KEEL_VERSION__"', "my-app", "0.83.9"),
    'name: "my-app", dep: "^0.83.9"',
  );
});

test("kit lock records hashes so untouched files are detectable", () => {
  const dir = join(tmpdir(), `keel-kit-sync-${process.pid}-${Date.now()}`);
  mkdirSync(join(dir, "app"), { recursive: true });

  const stock = "stock contents\n";
  const stockHash = hashText(stock);
  writeFileSync(join(dir, "app", "welcome.tsx"), stock);
  writeKitLock(dir, {
    preset: "minimal",
    version: "0.83.8",
    files: { "app/welcome.tsx": stockHash },
  });

  const lock = readKitLock(dir);
  assert.equal(lock?.preset, "minimal");
  assert.equal(lock?.files["app/welcome.tsx"], stockHash);
  assert.equal(hashText(readFileSync(join(dir, "app", "welcome.tsx"), "utf8")), stockHash);

  writeFileSync(join(dir, "app", "welcome.tsx"), "I edited this\n");
  assert.notEqual(hashText(readFileSync(join(dir, "app", "welcome.tsx"), "utf8")), stockHash);

  rmSync(dir, { recursive: true, force: true });
});

test("kit:sync against real templates adds missing files and respects customization", () => {
  const dir = join(tmpdir(), `keel-kit-sync-real-${process.pid}-${Date.now()}`);
  mkdirSync(join(dir, "node_modules", "@shaferllc"), { recursive: true });

  try {
    symlinkSync(process.cwd(), join(dir, "node_modules", "@shaferllc", "keel"));
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return; // no symlink privilege
  }

  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sync-test" }));
  const result = syncKit({
    appRoot: dir,
    preset: "minimal",
    dryRun: false,
    ui: createUi({ raw: true }),
  });

  assert.ok(result.added.length > 5, `expected many adds, got ${result.added.length}`);
  assert.ok(existsSync(join(dir, "routes", "web.ts")));
  assert.ok(existsSync(join(dir, ".keel", "kit.json")));
  assert.equal(readKitLock(dir)?.preset, "minimal");

  const again = syncKit({ appRoot: dir, preset: "minimal", ui: createUi({ raw: true }) });
  assert.equal(again.added.length, 0);
  assert.equal(again.updated.length, 0);
  assert.ok(again.unchanged.length > 0);

  writeFileSync(join(dir, "routes", "web.ts"), "// customized\n");
  const skipped = syncKit({ appRoot: dir, preset: "minimal", ui: createUi({ raw: true }) });
  assert.ok(skipped.skipped.includes("routes/web.ts"));

  const forced = syncKit({
    appRoot: dir,
    preset: "minimal",
    force: true,
    ui: createUi({ raw: true }),
  });
  assert.ok(forced.updated.includes("routes/web.ts"));
  assert.doesNotMatch(readFileSync(join(dir, "routes", "web.ts"), "utf8"), /customized/);

  rmSync(dir, { recursive: true, force: true });
});
