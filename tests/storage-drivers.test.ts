import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Storage } from "../src/core/storage.js";
import { localDisk } from "../src/storage/local.js";
import { s3Disk } from "../src/storage/s3.js";
import { r2Disk, type R2BucketLike, type R2ObjectLike } from "../src/storage/r2.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array | null): string | null =>
  data == null ? null : new TextDecoder().decode(data);

/* ------------------------------- local disk -------------------------------- */

async function withTempDisk(run: (disk: ReturnType<typeof localDisk>, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "keel-storage-"));
  try {
    await run(localDisk({ root }), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("local disk: round-trips files through the whole Disk surface", async () => {
  await withTempDisk(async (disk) => {
    const store = new Storage(disk);

    await store.put("notes/hello.txt", "hello world");
    assert.equal(await store.getText("notes/hello.txt"), "hello world");
    assert.equal(await store.exists("notes/hello.txt"), true);
    assert.equal(await store.exists("notes/missing.txt"), false);
    assert.equal(await store.get("notes/missing.txt"), null);

    const meta = await store.metadata("notes/hello.txt");
    assert.equal(meta?.size, 11);
    assert.equal(meta?.contentType, "text/plain; charset=utf-8");
    assert.ok(meta?.lastModified instanceof Date);

    await store.copy("notes/hello.txt", "copies/hello.txt");
    assert.equal(await store.getText("copies/hello.txt"), "hello world");

    await store.move("copies/hello.txt", "moved/hello.txt");
    assert.equal(await store.exists("copies/hello.txt"), false);
    assert.equal(await store.getText("moved/hello.txt"), "hello world");

    await store.delete("moved/hello.txt");
    assert.equal(await store.exists("moved/hello.txt"), false);
  });
});

test("local disk: lists nested files by prefix, with posix separators", async () => {
  await withTempDisk(async (disk) => {
    const store = new Storage(disk);
    await store.put("a/one.txt", "1");
    await store.put("a/deep/two.txt", "2");
    await store.put("b/three.txt", "3");

    assert.deepEqual(await store.list(), ["a/deep/two.txt", "a/one.txt", "b/three.txt"]);
    assert.deepEqual(await store.list("a/"), ["a/deep/two.txt", "a/one.txt"]);
    assert.deepEqual(await store.list("nope/"), []);
  });
});

test("local disk: maps visibility onto the file mode and reads it back", async () => {
  await withTempDisk(async (disk, root) => {
    await disk.put("public.txt", bytes("p"), { visibility: "public" });
    await disk.put("private.txt", bytes("s"), { visibility: "private" });

    assert.equal((await disk.metadata!("public.txt"))?.visibility, "public");
    assert.equal((await disk.metadata!("private.txt"))?.visibility, "private");

    // The mode is real, not just reported.
    assert.equal((await stat(join(root, "private.txt"))).mode & 0o004, 0);
  });
});

test("local disk: refuses paths that escape the root", async () => {
  await withTempDisk(async (disk) => {
    await assert.rejects(() => disk.get("../escape.txt"), /outside the disk root/);
    await assert.rejects(() => disk.put("a/../../escape.txt", bytes("x")), /outside the disk root/);
    // A path that only *looks* like it climbs out is fine.
    await disk.put("a/../inside.txt", bytes("x"));
    assert.equal(text(await disk.get("inside.txt")), "x");
  });
});

/* --------------------------------- s3 disk --------------------------------- */

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: ArrayBuffer;
}

/** A `fetch` stub that records calls and replies from a canned table. */
function stubFetch(responses: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  const fake = (async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? "GET",
      url: String(input),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as ArrayBuffer | undefined,
    };
    calls.push(call);
    return responses(call) ?? new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fake, calls };
}

const credentials = {
  bucket: "uploads",
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

test("s3 disk: signs writes with SigV4 and addresses the bucket virtual-host style", async () => {
  const { fetch: fake, calls } = stubFetch(() => undefined);
  const disk = s3Disk({ ...credentials, fetch: fake });

  await disk.put("avatars/1.png", bytes("png-bytes"), { cacheControl: "max-age=60" });

  const call = calls[0]!;
  assert.equal(call.method, "PUT");
  assert.equal(call.url, "https://uploads.s3.us-east-1.amazonaws.com/avatars/1.png");
  assert.equal(call.headers["content-type"], "image/png");
  assert.equal(call.headers["cache-control"], "max-age=60");
  assert.match(
    call.headers.Authorization!,
    /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
  );
  // Every signed request carries the payload hash, and it's the hash of the body.
  assert.match(call.headers["x-amz-content-sha256"]!, /^[0-9a-f]{64}$/);
  assert.match(call.headers["x-amz-date"]!, /^\d{8}T\d{6}Z$/);
});

test("s3 disk: puts the bucket in the path for a custom endpoint (R2, MinIO)", async () => {
  const { fetch: fake, calls } = stubFetch(() => undefined);
  const disk = s3Disk({
    ...credentials,
    region: "auto",
    endpoint: "https://acct.r2.cloudflarestorage.com",
    fetch: fake,
  });

  await disk.put("a/b c.txt", bytes("x"));
  assert.equal(calls[0]!.url, "https://acct.r2.cloudflarestorage.com/uploads/a/b%20c.txt");
});

test("s3 disk: reports a missing object as null rather than throwing", async () => {
  const { fetch: fake } = stubFetch((call) =>
    call.method === "GET" || call.method === "HEAD" ? new Response("", { status: 404 }) : undefined,
  );
  const disk = s3Disk({ ...credentials, fetch: fake });

  assert.equal(await disk.get("nope.txt"), null);
  assert.equal(await disk.exists("nope.txt"), false);
  assert.equal(await disk.metadata!("nope.txt"), null);
});

test("s3 disk: surfaces a real error status with the body", async () => {
  const { fetch: fake } = stubFetch(
    () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }),
  );
  const disk = s3Disk({ ...credentials, fetch: fake });

  await assert.rejects(() => disk.get("x.txt"), /403.*AccessDenied/s);
});

test("s3 disk: follows the continuation token so list() doesn't truncate", async () => {
  const page = (keys: string[], next?: string) =>
    new Response(
      `<ListBucketResult>${keys.map((k) => `<Key>${k}</Key>`).join("")}` +
        `<IsTruncated>${next ? "true" : "false"}</IsTruncated>` +
        (next ? `<NextContinuationToken>${next}</NextContinuationToken>` : "") +
        `</ListBucketResult>`,
      { status: 200 },
    );

  const { fetch: fake, calls } = stubFetch((call) =>
    call.url.includes("continuation-token=page2")
      ? page(["c.txt"])
      : page(["a.txt", "b.txt"], "page2"),
  );
  const disk = s3Disk({ ...credentials, fetch: fake });

  assert.deepEqual(await disk.list("docs/"), ["a.txt", "b.txt", "c.txt"]);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /list-type=2/);
  assert.match(calls[0]!.url, /prefix=docs%2F/);
});

test("s3 disk: decodes XML entities in listed keys", async () => {
  const { fetch: fake } = stubFetch(
    () =>
      new Response(
        "<ListBucketResult><Key>a&amp;b/c&apos;d.txt</Key><IsTruncated>false</IsTruncated></ListBucketResult>",
      ),
  );
  const disk = s3Disk({ ...credentials, fetch: fake });
  assert.deepEqual(await disk.list(), ["a&b/c'd.txt"]);
});

test("s3 disk: presigns read and upload URLs with the signature in the query", async () => {
  const disk = s3Disk({ ...credentials, fetch: stubFetch(() => undefined).fetch });

  const read = new URL(await disk.signedUrl!("invoices/42.pdf", { expiresIn: 300 }));
  assert.equal(read.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(read.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(read.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.match(read.searchParams.get("X-Amz-Signature")!, /^[0-9a-f]{64}$/);

  // An upload URL binds the content type, so the URL can't be reused for another.
  const upload = new URL(await disk.signedUploadUrl!("uploads/raw.mov"));
  assert.equal(upload.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
});

test("s3 disk: signatures differ by key, so a URL can't be replayed for another object", async () => {
  const disk = s3Disk({ ...credentials, fetch: stubFetch(() => undefined).fetch });

  const one = new URL(await disk.signedUrl!("a.txt")).searchParams.get("X-Amz-Signature");
  const two = new URL(await disk.signedUrl!("b.txt")).searchParams.get("X-Amz-Signature");
  assert.notEqual(one, two);
});

test("s3 disk: url() prefers the public base when one is configured", () => {
  const withCdn = s3Disk({ ...credentials, publicUrl: "https://cdn.example.com/", fetch: stubFetch(() => undefined).fetch });
  assert.equal(withCdn.url("a/b.png"), "https://cdn.example.com/a/b.png");

  const without = s3Disk({ ...credentials, fetch: stubFetch(() => undefined).fetch });
  assert.equal(without.url("a/b.png"), "https://uploads.s3.us-east-1.amazonaws.com/a/b.png");
});

test("s3 disk: copies server-side and moves by copy-then-delete", async () => {
  const { fetch: fake, calls } = stubFetch(() => undefined);
  const disk = s3Disk({ ...credentials, fetch: fake });

  await disk.move!("from/a.txt", "to/b.txt");

  assert.equal(calls[0]!.method, "PUT");
  assert.equal(calls[0]!.headers["x-amz-copy-source"], "/uploads/from/a.txt");
  assert.equal(calls[1]!.method, "DELETE");
  assert.match(calls[1]!.url, /from\/a\.txt$/);
  // The bytes never came through us.
  assert.equal(calls[0]!.body, undefined);
});

/* --------------------------------- r2 disk --------------------------------- */

/** An in-memory stand-in for the R2 binding, paging at two objects. */
function fakeBucket(): R2BucketLike {
  const files = new Map<string, { body: Uint8Array; object: R2ObjectLike }>();

  return {
    async put(key, value, options) {
      const body = value instanceof Uint8Array ? value : new Uint8Array(value);
      files.set(key, {
        body,
        object: {
          key,
          size: body.byteLength,
          uploaded: new Date(0),
          httpMetadata: options?.httpMetadata,
          customMetadata: options?.customMetadata,
        },
      });
    },
    async get(key) {
      const entry = files.get(key);
      if (!entry) return null;
      const bytes = entry.body;
      return {
        ...entry.object,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      };
    },
    async head(key) {
      return files.get(key)?.object ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
    async list(options = {}) {
      const all = [...files.keys()].filter((k) => k.startsWith(options.prefix ?? "")).sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const slice = all.slice(start, start + 2);
      const end = start + slice.length;
      return {
        objects: slice.map((key) => files.get(key)!.object),
        truncated: end < all.length,
        cursor: String(end),
      };
    },
  };
}

test("r2 disk: round-trips bytes and metadata through the binding", async () => {
  const store = new Storage(r2Disk(fakeBucket()));

  await store.put("avatars/1.png", bytes("png"), { cacheControl: "max-age=60" });
  assert.equal(text(await store.get("avatars/1.png")), "png");
  assert.equal(await store.exists("avatars/1.png"), true);

  const meta = await store.metadata("avatars/1.png");
  assert.equal(meta?.size, 3);
  assert.equal(meta?.contentType, "image/png");
  assert.equal(meta?.cacheControl, "max-age=60");

  await store.delete("avatars/1.png");
  assert.equal(await store.exists("avatars/1.png"), false);
  assert.equal(await store.get("avatars/1.png"), null);
});

test("r2 disk: follows the list cursor across pages", async () => {
  const disk = r2Disk(fakeBucket());
  for (const name of ["a", "b", "c", "d", "e"]) await disk.put(`docs/${name}.txt`, bytes(name));
  await disk.put("other.txt", bytes("x"));

  assert.deepEqual(await disk.list("docs/"), [
    "docs/a.txt",
    "docs/b.txt",
    "docs/c.txt",
    "docs/d.txt",
    "docs/e.txt",
  ]);
  assert.equal((await disk.list()).length, 6);
});

test("r2 disk: copy carries metadata, and move falls back to copy-then-delete", async () => {
  const store = new Storage(r2Disk(fakeBucket()));

  await store.put("a.png", bytes("x"), { cacheControl: "max-age=99", metadata: { owner: "7" } });
  await store.move("a.png", "b.png");

  assert.equal(await store.exists("a.png"), false);
  const meta = await store.metadata("b.png");
  assert.equal(meta?.cacheControl, "max-age=99");
  assert.deepEqual(meta?.metadata, { owner: "7" });
});

test("r2 disk: url() uses the public base, and signed uploads are refused", async () => {
  const store = new Storage(r2Disk(fakeBucket(), { publicUrl: "https://cdn.example.com/" }));
  assert.equal(store.url("a/b.png"), "https://cdn.example.com/a/b.png");

  // A binding cannot presign — say so rather than minting a URL that won't work.
  await assert.rejects(() => store.signedUploadUrl("a/b.png"), /does not support signed upload URLs/);
});
