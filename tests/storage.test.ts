import { test } from "node:test";
import assert from "node:assert/strict";

import { Storage, MemoryDisk, storage, setDisk, type Disk } from "../src/core/storage.js";

test("put/get round-trips strings and bytes", async () => {
  const s = new Storage(new MemoryDisk());
  await s.put("notes/hello.txt", "hi there");
  assert.equal(await s.getText("notes/hello.txt"), "hi there");

  const bytes = new Uint8Array([1, 2, 3]);
  await s.put("bin/data", bytes);
  assert.deepEqual(await s.get("bin/data"), bytes);
});

test("get / getText return null for a missing file", async () => {
  const s = new Storage(new MemoryDisk());
  assert.equal(await s.get("nope"), null);
  assert.equal(await s.getText("nope"), null);
});

test("exists and delete", async () => {
  const s = new Storage(new MemoryDisk());
  await s.put("a.txt", "x");
  assert.equal(await s.exists("a.txt"), true);
  await s.delete("a.txt");
  assert.equal(await s.exists("a.txt"), false);
});

test("list, optionally filtered by prefix", async () => {
  const s = new Storage(new MemoryDisk());
  await s.put("avatars/1.png", "a");
  await s.put("avatars/2.png", "b");
  await s.put("docs/readme.md", "c");
  assert.deepEqual(await s.list("avatars/"), ["avatars/1.png", "avatars/2.png"]);
  assert.equal((await s.list()).length, 3);
});

test("url comes from the disk", async () => {
  const s = new Storage(new MemoryDisk("/files"));
  assert.equal(s.url("avatars/1.png"), "/files/avatars/1.png");
});

test("ArrayBuffer contents are accepted", async () => {
  const s = new Storage(new MemoryDisk());
  const buf = new TextEncoder().encode("buffered").buffer;
  await s.put("b", buf);
  assert.equal(await s.getText("b"), "buffered");
});

test("default disk works out of the box; named disks are selectable", async () => {
  await storage().put("k", "default-disk");
  assert.equal(await storage().getText("k"), "default-disk");

  setDisk(new MemoryDisk(), "s3");
  await storage("s3").put("k", "s3-disk");
  assert.equal(await storage("s3").getText("k"), "s3-disk");
  // the two disks are independent
  assert.equal(await storage().getText("k"), "default-disk");
});

test("storage() throws for an unknown disk name", () => {
  assert.throws(() => storage("nope"), /No storage disk named "nope"/);
});

test("a custom Disk receives the calls", async () => {
  const calls: string[] = [];
  const disk: Disk = {
    async put(p) {
      calls.push(`put ${p}`);
    },
    async get() {
      return null;
    },
    async exists() {
      return false;
    },
    async delete(p) {
      calls.push(`delete ${p}`);
    },
    async list() {
      return [];
    },
    url: (p) => `https://cdn.example/${p}`,
  };
  const s = new Storage(disk);
  await s.put("x.png", "data");
  await s.delete("x.png");
  assert.deepEqual(calls, ["put x.png", "delete x.png"]);
  assert.equal(s.url("x.png"), "https://cdn.example/x.png");
  assert.equal(s.driver, disk);
});
