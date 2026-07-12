import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

import { Model } from "../src/core/model.js";
import { setConnection, clearConnections, connection } from "../src/core/database.js";
import { libsqlConnection, type LibSqlLike } from "../src/db/libsql.js";

async function boot(): Promise<void> {
  clearConnections();
  const client = createClient({ url: ":memory:" });
  setConnection(libsqlConnection(client as unknown as LibSqlLike), "sqlite");

  await connection().write("CREATE TABLE posts (id INTEGER PRIMARY KEY, teamId INTEGER)", []);
  await connection().write("INSERT INTO posts (id, teamId) VALUES (1, 1), (2, 2), (3, 1)", []);
}

/**
 * A global scope declared on a base class MUST constrain its subclasses.
 *
 * This is the shape multi-tenancy takes — one `TenantModel` that every tenant-owned
 * model extends. If the scope doesn't inherit, `Post.query()` comes back completely
 * unconstrained, which for a tenancy scope means every customer's rows. A scope that
 * silently does nothing fails *open*, and that is the one direction it must never
 * fail.
 */
test("a global scope on a base class applies to its subclasses", async () => {
  await boot();

  class TenantModel extends Model {}
  TenantModel.addGlobalScope("tenant", (q) => q.where("teamId", 1));

  class Post extends TenantModel {
    static override table = "posts";
  }

  const rows = await Post.query().get();
  assert.deepEqual(
    rows.map((r) => r.id),
    [1, 3],
    "the subclass must not see team 2's rows",
  );
});

test("a global scope on the concrete class still works", async () => {
  await boot();

  class Post extends Model {
    static override table = "posts";
  }
  Post.addGlobalScope("tenant", (q) => q.where("teamId", 2));

  const rows = await Post.query().get();
  assert.deepEqual(rows.map((r) => r.id), [2]);
});

test("a subclass can override an ancestor's scope by reusing its name", async () => {
  await boot();

  class Base extends Model {}
  Base.addGlobalScope("tenant", (q) => q.where("teamId", 1));

  class Post extends Base {
    static override table = "posts";
  }
  // The nearest declaration of a name wins.
  Post.addGlobalScope("tenant", (q) => q.where("teamId", 2));

  const rows = await Post.query().get();
  assert.deepEqual(rows.map((r) => r.id), [2]);
});

test("scopes from several levels of the chain all apply", async () => {
  await boot();

  class A extends Model {}
  A.addGlobalScope("team", (q) => q.where("teamId", 1));

  class B extends A {}
  B.addGlobalScope("firstOnly", (q) => q.where("id", 1));

  class Post extends B {
    static override table = "posts";
  }

  const rows = await Post.query().get();
  assert.deepEqual(rows.map((r) => r.id), [1]);
});

test("withoutGlobalScope escapes a named scope — explicitly, so it's greppable", async () => {
  await boot();

  class TenantModel extends Model {}
  TenantModel.addGlobalScope("tenant", (q) => q.where("teamId", 1));

  class Post extends TenantModel {
    static override table = "posts";
  }

  assert.deepEqual((await Post.query().get()).map((r) => r.id), [1, 3]);

  const all = await Post.withoutGlobalScope("tenant").get();
  assert.deepEqual(all.map((r) => r.id), [1, 2, 3], "the escape hatch sees everything");

  const none = await Post.withoutGlobalScopes().get();
  assert.deepEqual(none.map((r) => r.id), [1, 2, 3]);
});

test("one model's scope doesn't leak onto a sibling", async () => {
  await boot();

  class Base extends Model {}

  class Scoped extends Base {
    static override table = "posts";
  }
  Scoped.addGlobalScope("tenant", (q) => q.where("teamId", 1));

  class Unscoped extends Base {
    static override table = "posts";
  }

  assert.deepEqual((await Scoped.query().get()).map((r) => r.id), [1, 3]);
  assert.deepEqual(
    (await Unscoped.query().get()).map((r) => r.id),
    [1, 2, 3],
    "a sibling must not inherit its sibling's scope",
  );
});
