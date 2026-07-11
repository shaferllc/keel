import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { hash, encryption } from "../src/core/crypto.js";

test("hash: make, verify, and needsRehash", async () => {
  const hashed = await hash.make("s3cret");
  assert.match(hashed, /^pbkdf2_sha256\$/);
  assert.equal(await hash.verify(hashed, "s3cret"), true);
  assert.equal(await hash.verify(hashed, "wrong"), false);
  assert.equal(await hash.verify("garbage", "s3cret"), false);

  assert.equal(hash.needsRehash(hashed), false);
  assert.equal(hash.needsRehash("pbkdf2_sha256$1000$a$b", 100_000), true);
});

test("hash.verify returns false (never throws) on malformed hashes", async () => {
  // Right prefix, but broken iteration count / salt — previously threw.
  assert.equal(await hash.verify("pbkdf2_sha256$abc$c2FsdA==$aGFzaA==", "x"), false);
  assert.equal(await hash.verify("pbkdf2_sha256$0$c2FsdA==$aGFzaA==", "x"), false);
  assert.equal(await hash.verify("pbkdf2_sha256$1000$!!notbase64!!$aGFzaA==", "x"), false);
  assert.equal(await hash.verify("", "x"), false);
});

test("hash.fake swaps in a trivial scheme, restore brings back PBKDF2", async () => {
  hash.fake();
  try {
    const hashed = await hash.make("s3cret");
    assert.equal(hashed, "fake$s3cret"); // trivial, no PBKDF2
    assert.equal(await hash.verify(hashed, "s3cret"), true);
    assert.equal(await hash.verify(hashed, "wrong"), false);
    assert.equal(hash.needsRehash(hashed), false);
  } finally {
    hash.restore();
  }
  // Back to real hashing.
  const real = await hash.make("s3cret");
  assert.match(real, /^pbkdf2_sha256\$/);
  assert.equal(await hash.verify(real, "s3cret"), true);
});

test("encryption: round-trips values and rejects tampering", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { key: "test-secret-key" } } });

  const token = await encryption.encrypt({ userId: 1, role: "admin" });
  assert.deepEqual(await encryption.decrypt(token), { userId: 1, role: "admin" });

  assert.equal(await encryption.decrypt("not-valid"), null);
  assert.equal(await encryption.decrypt(token.slice(0, -6) + "AAAAAA"), null);
});
