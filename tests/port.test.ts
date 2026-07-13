import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";

import { findAvailablePort } from "../src/core/cli/port.js";

test("findAvailablePort returns the preferred port when it is free", async () => {
  const preferred = await findAvailablePort(0); // OS-assigned free port as a baseline
  const again = await findAvailablePort(preferred);
  assert.equal(again, preferred);
});

test("findAvailablePort skips a port that is already bound", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, () => resolve());
  });
  const address = blocker.address();
  assert.ok(address && typeof address === "object");
  const busy = address.port;

  try {
    const port = await findAvailablePort(busy);
    assert.notEqual(port, busy);
    assert.ok(port > busy);
  } finally {
    await new Promise<void>((resolve, reject) => {
      blocker.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("findAvailablePort rejects a nonsensical preferred port", async () => {
  await assert.rejects(() => findAvailablePort(-1), /Invalid port/);
  await assert.rejects(() => findAvailablePort(1.5), /Invalid port/);
});
