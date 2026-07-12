import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Storage,
  MemoryDisk,
  storage,
  setDisk,
  fakeDisk,
  restoreDisk,
  serveStorage,
  signStorageUrl,
  verifyStorageUrl,
  contentTypeFor,
  type Disk,
} from "../src/core/storage.js";
import { Application } from "../src/core/application.js";

/** Signed URLs read `config('app.key')`, so tests need a booted app. */
async function bootApp(key = "test-storage-key"): Promise<void> {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { key } } });
}

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

/* ---------------------------- content type -------------------------------- */

test("contentTypeFor infers from the extension, else octet-stream", () => {
  assert.equal(contentTypeFor("avatars/1.png"), "image/png");
  assert.equal(contentTypeFor("data.json"), "application/json");
  // Text types carry a charset.
  assert.equal(contentTypeFor("notes/todo.txt"), "text/plain; charset=utf-8");
  // No extension, or one we don't know.
  assert.equal(contentTypeFor("data"), "application/octet-stream");
});

test("put infers a content type from the path, and an explicit one wins", async () => {
  const s = new Storage(new MemoryDisk());

  await s.put("avatars/1.png", "fake-png");
  assert.equal((await s.metadata("avatars/1.png"))?.contentType, "image/png");

  await s.put("weird.bin", "x", { contentType: "application/vnd.custom" });
  assert.equal((await s.metadata("weird.bin"))?.contentType, "application/vnd.custom");
});

test("the disk receives the inferred content type on put", async () => {
  let seen: string | undefined;
  const disk: Disk = {
    async put(_p, _b, options) {
      seen = options?.contentType;
    },
    async get() {
      return null;
    },
    async exists() {
      return false;
    },
    async delete() {},
    async list() {
      return [];
    },
    url: (p) => `/x/${p}`,
  };
  await new Storage(disk).put("logo.svg", "<svg/>");
  assert.equal(seen, "image/svg+xml; charset=utf-8");
});

/* ------------------------------ metadata ---------------------------------- */

test("metadata and size", async () => {
  const s = new Storage(new MemoryDisk());
  await s.put("a.txt", "12345", { cacheControl: "public, max-age=60", visibility: "private" });

  const meta = await s.metadata("a.txt");
  assert.equal(meta?.size, 5);
  assert.equal(meta?.contentType, "text/plain; charset=utf-8");
  assert.equal(meta?.cacheControl, "public, max-age=60");
  assert.equal(meta?.visibility, "private");
  assert.ok(meta?.lastModified instanceof Date);

  assert.equal(await s.size("a.txt"), 5);
  assert.equal(await s.metadata("nope"), null);
  assert.equal(await s.size("nope"), null);
});

test("metadata falls back to a read when the disk can't report it", async () => {
  const disk: Disk = {
    async put() {},
    async get() {
      return new Uint8Array([1, 2, 3, 4]);
    },
    async exists() {
      return true;
    },
    async delete() {},
    async list() {
      return [];
    },
    url: (p) => `/x/${p}`,
  };
  const meta = await new Storage(disk).metadata("a.png");
  assert.equal(meta?.size, 4);
  assert.equal(meta?.contentType, "image/png");
});

/* ------------------------------ copy / move ------------------------------- */

test("copy duplicates the file and its metadata; move removes the source", async () => {
  const s = new Storage(new MemoryDisk());
  await s.put("a.txt", "hello", { cacheControl: "max-age=1" });

  await s.copy("a.txt", "b.txt");
  assert.equal(await s.getText("a.txt"), "hello");
  assert.equal(await s.getText("b.txt"), "hello");
  assert.equal((await s.metadata("b.txt"))?.cacheControl, "max-age=1");

  await s.move("a.txt", "c.txt");
  assert.equal(await s.exists("a.txt"), false);
  assert.equal(await s.getText("c.txt"), "hello");
});

test("copy/move fall back to read-then-write on a disk without them", async () => {
  const files = new Map<string, Uint8Array>();
  const disk: Disk = {
    async put(p, b) {
      files.set(p, b);
    },
    async get(p) {
      return files.get(p) ?? null;
    },
    async exists(p) {
      return files.has(p);
    },
    async delete(p) {
      files.delete(p);
    },
    async list() {
      return [...files.keys()];
    },
    url: (p) => `/x/${p}`,
  };
  const s = new Storage(disk);
  await s.put("a.txt", "hi");

  await s.move("a.txt", "b.txt");
  assert.equal(files.has("a.txt"), false);
  assert.equal(new TextDecoder().decode(files.get("b.txt")), "hi");

  await assert.rejects(() => s.copy("gone.txt", "x.txt"), /no such file/);
});

/* ----------------------------- signed URLs -------------------------------- */

test("signStorageUrl round-trips through verifyStorageUrl", async () => {
  await bootApp();
  const signed = await signStorageUrl("/storage/invoices/42.pdf", 60);
  assert.match(signed, /expires=\d+/);
  assert.match(signed, /signature=[a-f0-9]{64}/);
  assert.equal(await verifyStorageUrl(signed), true);
});

test("a tampered path or signature fails verification", async () => {
  await bootApp();
  const signed = await signStorageUrl("/storage/invoices/42.pdf", 60);

  assert.equal(await verifyStorageUrl(signed.replace("42.pdf", "43.pdf")), false);
  assert.equal(await verifyStorageUrl(signed.replace(/signature=.*/, "signature=deadbeef")), false);
  assert.equal(await verifyStorageUrl("/storage/invoices/42.pdf"), false); // unsigned
});

test("an expired signature fails verification", async () => {
  await bootApp();
  const expired = await signStorageUrl("/storage/a.txt", -10); // already in the past
  assert.equal(await verifyStorageUrl(expired), false);
});

test("a signature made with a different app key fails verification", async () => {
  await bootApp("key-one");
  const signed = await signStorageUrl("/storage/a.txt", 60);

  await bootApp("key-two");
  assert.equal(await verifyStorageUrl(signed), false);
});

test("verification ignores the host, so a signed URL survives a CDN hostname", async () => {
  await bootApp();
  const signed = await signStorageUrl("/storage/a.txt", 60);
  assert.equal(await verifyStorageUrl(`https://cdn.example.com${signed}`), true);
});

test("storage().signedUrl signs the disk's url when the disk can't presign", async () => {
  await bootApp();
  const s = new Storage(new MemoryDisk("/storage"));
  const url = await s.signedUrl("invoices/42.pdf", { expiresIn: 60 });
  assert.ok(url.startsWith("/storage/invoices/42.pdf?"));
  assert.equal(await verifyStorageUrl(url), true);
});

test("storage().signedUrl delegates to a disk that can presign", async () => {
  const disk: Disk = {
    async put() {},
    async get() {
      return null;
    },
    async exists() {
      return false;
    },
    async delete() {},
    async list() {
      return [];
    },
    url: (p) => `https://bucket.r2.dev/${p}`,
    async signedUrl(path, options) {
      return `https://bucket.r2.dev/${path}?X-Amz-Expires=${options?.expiresIn ?? 3600}`;
    },
  };
  const url = await new Storage(disk).signedUrl("a.pdf", { expiresIn: 300 });
  assert.equal(url, "https://bucket.r2.dev/a.pdf?X-Amz-Expires=300");
});

test("signedUploadUrl delegates to the disk, with an inferred content type", async () => {
  let seenType: string | undefined;
  const disk: Disk = {
    async put() {},
    async get() {
      return null;
    },
    async exists() {
      return false;
    },
    async delete() {},
    async list() {
      return [];
    },
    url: (p) => `https://bucket.r2.dev/${p}`,
    async signedUploadUrl(path, options) {
      seenType = options?.contentType;
      return `https://bucket.r2.dev/${path}?upload=1`;
    },
  };
  const url = await new Storage(disk).signedUploadUrl("uploads/clip.mp4");
  assert.equal(url, "https://bucket.r2.dev/uploads/clip.mp4?upload=1");
  assert.equal(seenType, "video/mp4");
});

test("signedUploadUrl throws a helpful error on a disk that can't presign uploads", async () => {
  const s = new Storage(new MemoryDisk());
  await assert.rejects(
    () => s.signedUploadUrl("uploads/a.png"),
    /does not support signed upload URLs/,
  );
});

/* -------------------------------- faking ---------------------------------- */

test("fakeDisk swaps in an in-memory disk and restoreDisk puts the real one back", async () => {
  const real = new MemoryDisk("/real");
  setDisk(real, "uploads");
  await storage("uploads").put("keep.txt", "real");

  const fake = fakeDisk("uploads");
  assert.equal(storage("uploads"), fake);
  assert.equal(await storage("uploads").exists("keep.txt"), false); // fake starts empty

  await storage("uploads").put("avatars/1.png", "bytes");
  await fake.assertExists("avatars/1.png");

  restoreDisk("uploads");
  assert.equal(storage("uploads").driver, real);
  assert.equal(await storage("uploads").getText("keep.txt"), "real");
});

test("faking twice still restores the real disk", async () => {
  const real = new MemoryDisk("/real");
  setDisk(real, "twice");

  fakeDisk("twice");
  fakeDisk("twice");
  restoreDisk("twice");

  assert.equal(storage("twice").driver, real);
});

test("restoreDisk with no name restores every faked disk", async () => {
  const a = new MemoryDisk("/a");
  const b = new MemoryDisk("/b");
  setDisk(a, "a");
  setDisk(b, "b");

  fakeDisk("a");
  fakeDisk("b");
  restoreDisk();

  assert.equal(storage("a").driver, a);
  assert.equal(storage("b").driver, b);
});

test("fake disk assertions pass and fail as expected", async () => {
  const disk = fakeDisk("assertions");
  await disk.put("a.txt", "hello");

  await disk.assertExists("a.txt");
  await disk.assertMissing("b.txt");
  await disk.assertContents("a.txt", "hello");
  await disk.assertCount(1);

  await assert.rejects(() => disk.assertMissing("a.txt"), /to be missing/);
  await assert.rejects(() => disk.assertExists("b.txt"), /to exist/);
  await assert.rejects(() => disk.assertContents("a.txt", "nope"), /to contain/);
  await assert.rejects(() => disk.assertCount(5), /Expected 5 file\(s\)/);

  restoreDisk();
});

test("assertCount can be scoped to a prefix", async () => {
  const disk = fakeDisk("prefixed");
  await disk.put("avatars/1.png", "a");
  await disk.put("avatars/2.png", "b");
  await disk.put("docs/x.md", "c");

  await disk.assertCount(2, "avatars/");
  await disk.assertCount(3);
  await assert.rejects(() => disk.assertCount(1, "avatars/"), /under "avatars\/"/);

  restoreDisk();
});

/* ------------------------------ serveStorage ------------------------------ */

test("serveStorage serves a file with its content type and an ETag", async () => {
  const disk = fakeDisk("serve");
  await disk.put("avatars/1.png", "png-bytes");

  const handler = serveStorage({ disk: "serve" });
  const res = await runMiddleware(handler, "http://app.test/storage/avatars/1.png");

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/png");
  assert.ok(res.headers.get("ETag"));
  assert.equal(await res.text(), "png-bytes");

  restoreDisk();
});

test("serveStorage falls through for a path it doesn't own or a file it lacks", async () => {
  fakeDisk("serve2");
  const handler = serveStorage({ disk: "serve2" });

  const other = await runMiddleware(handler, "http://app.test/api/users");
  assert.equal(await other.text(), "next"); // not under basePath

  const missing = await runMiddleware(handler, "http://app.test/storage/nope.png");
  assert.equal(await missing.text(), "next"); // disk has no such file

  restoreDisk();
});

test("serveStorage in signed mode rejects unsigned and expired URLs", async () => {
  await bootApp();
  // The disk's url() prefix must line up with basePath — see the mismatch test below.
  const disk = setDisk(new MemoryDisk("/private"), "private");
  await disk.put("invoices/42.pdf", "secret");

  const handler = serveStorage({ disk: "private", basePath: "/private", signed: true });

  const unsigned = await runMiddleware(handler, "http://app.test/private/invoices/42.pdf");
  assert.equal(unsigned.status, 403);

  const signed = await signStorageUrl("/private/invoices/42.pdf", 60);
  const ok = await runMiddleware(handler, `http://app.test${signed}`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "secret");

  const stale = await signStorageUrl("/private/invoices/42.pdf", -10);
  const expired = await runMiddleware(handler, `http://app.test${stale}`);
  assert.equal(expired.status, 403);

  restoreDisk();
});

test("a basePath that doesn't match the disk's url() prefix fails loudly", async () => {
  await bootApp();

  // The disk hands out /storage/… while serveStorage listens on /private, so no
  // signature could ever match. That must not look like an expired link — it's a
  // misconfiguration, and it says so.
  const mismatched = setDisk(new MemoryDisk("/storage"), "mismatched");
  await mismatched.put("a.txt", "secret");
  const url = await mismatched.signedUrl("a.txt", { expiresIn: 60 });
  assert.ok(url.startsWith("/storage/a.txt?"));

  const handler = serveStorage({ disk: "mismatched", basePath: "/private", signed: true });

  const { Hono } = await import("hono");
  const app = new Hono();
  let thrown: unknown;
  app.onError((err, c) => {
    thrown = err;
    return c.text("error", 500);
  });
  app.use("*", handler);
  app.all("*", (c) => c.text("next"));

  const res = await app.request(
    new Request(`http://app.test/private/a.txt${url.slice(url.indexOf("?"))}`),
  );

  // A 500 with a real explanation — not a 403, which would read as "your link expired".
  assert.equal(res.status, 500);
  assert.match(
    (thrown as Error).message,
    /the disk serves "a\.txt" at "\/storage\/a\.txt", but this middleware is mounted at "\/private\/a\.txt"/,
  );
  assert.match((thrown as Error).message, /new MemoryDisk\("\/private"\)/);
});

test("a matching basePath and disk prefix serve a signed URL", async () => {
  await bootApp();

  const aligned = setDisk(new MemoryDisk("/private"), "aligned");
  await aligned.put("a.txt", "ok");

  const good = await aligned.signedUrl("a.txt", { expiresIn: 60 });
  assert.ok(good.startsWith("/private/a.txt?"));

  const res = await runMiddleware(
    serveStorage({ disk: "aligned", basePath: "/private", signed: true }),
    `http://app.test${good}`,
  );
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
});

test("serveStorage guards against path traversal", async () => {
  const disk = fakeDisk("traversal");
  await disk.put("a.txt", "x");

  const handler = serveStorage({ disk: "traversal" });
  const res = await runMiddleware(handler, "http://app.test/storage/../../etc/passwd");
  assert.equal(await res.text(), "next");

  restoreDisk();
});

test("serveStorage answers a matching If-None-Match with a 304", async () => {
  const disk = fakeDisk("etag");
  await disk.put("a.txt", "x");

  const handler = serveStorage({ disk: "etag" });
  const first = await runMiddleware(handler, "http://app.test/storage/a.txt");
  const etag = first.headers.get("ETag")!;

  const second = await runMiddleware(handler, "http://app.test/storage/a.txt", {
    "If-None-Match": etag,
  });
  assert.equal(second.status, 304);

  restoreDisk();
});

/** Run a Hono middleware against a URL; the "next" handler returns the text "next". */
async function runMiddleware(
  handler: ReturnType<typeof serveStorage>,
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const { Hono } = await import("hono");
  const app = new Hono();
  app.use("*", handler);
  app.all("*", (c) => c.text("next"));
  return app.request(new Request(url, { headers }));
}
