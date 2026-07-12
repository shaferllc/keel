import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { PackageProvider, MigrationRegistry, PublishRegistry } from "../src/core/package.js";
import { Router } from "../src/core/http/router.js";
import {
  runRequest,
  currentRequestId,
  newRequestId,
} from "../src/core/instrumentation.js";
import { listen } from "../src/core/helpers.js";
import {
  setConnection,
  clearConnections,
  db,
  type Connection,
} from "../src/core/database.js";
import type { Migration } from "../src/core/migrations.js";
import type { QueryEvent } from "../src/core/instrumentation.js";

/** Let a fire-and-forget instrumentation emit settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

test("instrumentation: db.query fires with sql, connection, kind, requestId", async () => {
  new Application(); // makes this the active app so instrument() has an emitter
  clearConnections();
  const conn: Connection = {
    async select() {
      return [];
    },
    async write() {
      return { rowsAffected: 0 };
    },
  };
  setConnection(conn, "sqlite");

  const seen: QueryEvent[] = [];
  listen<QueryEvent>("db.query", (e) => seen.push(e));

  await runRequest("req-123", async () => {
    await db("users").where("id", 1).get();
  });
  await tick();

  assert.equal(seen.length, 1);
  assert.match(seen[0]!.sql.toLowerCase(), /select/);
  assert.equal(seen[0]!.connection, "default");
  assert.equal(seen[0]!.kind, "select");
  assert.equal(seen[0]!.requestId, "req-123");
  clearConnections();
});

test("instrumentation: request scope threads a request id through async work", async () => {
  assert.equal(currentRequestId(), undefined);
  const id = newRequestId();
  const inside = await runRequest(id, async () => {
    await Promise.resolve();
    return currentRequestId();
  });
  assert.equal(inside, id);
  assert.equal(currentRequestId(), undefined); // scope closed
});

/** A package that exercises every PackageProvider helper. */
const testMigration: Migration = {
  name: "testpkg_00_create",
  up() {},
  down() {},
};

class TestPackageProvider extends PackageProvider {
  readonly name = "testpkg";

  register(): void {
    this.mergeConfig("testpkg", { enabled: true, path: "testpkg", nested: { a: 1 } });
    this.migrations([testMigration]);
    this.publishes({ "/abs/config.stub": "config/testpkg.ts" }, "testpkg-config");
  }

  boot(): void {
    this.routes(
      (r) => {
        r.get("/ping", (c) => c.json({ ok: true })).name("ping");
      },
      { prefix: this.app.config().get("testpkg.path", "testpkg"), as: "testpkg" },
    );
  }
}

test("PackageProvider: merges config, registers routes/migrations/publishes", async () => {
  const app = new Application();
  await app.boot([TestPackageProvider], { discoverConfig: false });

  // mergeConfig applied defaults (app had none to override them).
  assert.equal(app.config().get("testpkg.enabled"), true);
  assert.equal(app.config().get("testpkg.nested.a"), 1);

  // routes() mounted a prefixed, name-prefixed route on the Router.
  const routes = app.make(Router).all();
  const ping = routes.find((r) => r.path === "/testpkg/ping");
  assert.ok(ping, "expected /testpkg/ping to be registered");
  assert.equal(ping!.name, "testpkg.ping");

  // migrations() and publishes() reached their registries.
  assert.deepEqual(
    app.make(MigrationRegistry).all().map((m) => m.name),
    ["testpkg_00_create"],
  );
  const published = app.make(PublishRegistry).all("testpkg-config");
  assert.equal(published.length, 1);
  assert.equal(published[0]!.files["/abs/config.stub"], "config/testpkg.ts");
});

test("PackageProvider: app config overrides package defaults (deep merge)", async () => {
  const app = new Application();
  await app.boot([TestPackageProvider], {
    discoverConfig: false,
    config: { testpkg: { path: "custom", nested: { b: 2 } } },
  });
  // App value wins, defaults fill the gaps, nested merges rather than replacing.
  assert.equal(app.config().get("testpkg.path"), "custom");
  assert.equal(app.config().get("testpkg.enabled"), true);
  assert.equal(app.config().get("testpkg.nested.a"), 1);
  assert.equal(app.config().get("testpkg.nested.b"), 2);
});
