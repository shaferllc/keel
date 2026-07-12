import { test } from "node:test";
import assert from "node:assert/strict";

import { d1HttpConnection } from "../src/db/d1-http.js";

/** Stand in for Cloudflare's API so the adapter is tested without the network. */
function fakeD1(handler: (body: { sql: string; params: unknown[] }) => unknown) {
  const calls: { sql: string; params: unknown[] }[] = [];

  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { sql: string; params: unknown[] };
    calls.push(body);

    return {
      ok: true,
      status: 200,
      json: async () => handler(body),
    };
  }) as unknown as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = original) };
}

const options = { accountId: "acct", databaseId: "db", apiToken: "token" };

test("select returns the rows D1 sends back", async () => {
  const d1 = fakeD1(() => ({
    success: true,
    result: [{ results: [{ id: 1, title: "Hello" }] }],
  }));

  const rows = await d1HttpConnection(options).select("SELECT * FROM posts WHERE id = ?", [1]);

  assert.deepEqual(rows, [{ id: 1, title: "Hello" }]);
  assert.equal(d1.calls[0]!.sql, "SELECT * FROM posts WHERE id = ?");
  assert.deepEqual(d1.calls[0]!.params, [1]);

  d1.restore();
});

test("write reports rows affected and the insert id", async () => {
  const d1 = fakeD1(() => ({
    success: true,
    result: [{ meta: { changes: 1, last_row_id: 42 } }],
  }));

  const result = await d1HttpConnection(options).write("INSERT INTO posts (title) VALUES (?)", [
    "Hi",
  ]);

  assert.equal(result.rowsAffected, 1);
  assert.equal(result.insertId, 42);

  d1.restore();
});

/**
 * Cloudflare frequently returns its errors in the body *with a 200*, so trusting
 * the status would let a failed migration look like it succeeded — the worst
 * possible outcome for a schema change.
 */
test("an error in the body is an error, even when the status is 200", async () => {
  const d1 = fakeD1(() => ({
    success: false,
    errors: [{ code: 7500, message: "no such table: posts" }],
  }));

  await assert.rejects(
    () => d1HttpConnection(options).select("SELECT * FROM posts", []),
    /no such table: posts/,
  );

  d1.restore();
});

test("an empty result set is an empty array, not undefined", async () => {
  const d1 = fakeD1(() => ({ success: true, result: [{}] }));

  assert.deepEqual(await d1HttpConnection(options).select("SELECT 1", []), []);

  d1.restore();
});
