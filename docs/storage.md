# Storage

File storage over a pluggable **disk** — like the database and mail layers, the
core imports no filesystem or SDK, so it runs on Node and the edge. Point a disk
at the local filesystem, S3, or a Cloudflare R2 binding; `MemoryDisk` is the
built-in default for tests.

## Using it

Register a disk once (in a service provider), then reach it anywhere with
`storage()`:

```ts
import { storage, setDisk, MemoryDisk } from "@shaferllc/keel/core";

setDisk(new MemoryDisk()); // swap for a local / S3 / R2 disk in production

await storage().put("avatars/1.png", bytes); // string | Uint8Array | ArrayBuffer
const bytes = await storage().get("avatars/1.png"); // Uint8Array | null
const text = await storage().getText("notes/todo.md"); // string | null
await storage().exists("avatars/1.png"); // boolean
await storage().delete("avatars/1.png");
const files = await storage().list("avatars/"); // paths under a prefix
const url = storage().url("avatars/1.png"); // a public URL for the object
```

The default disk is a `MemoryDisk`, so `storage()` works out of the box in tests.

## Writing files

The **content type is inferred from the extension**, so a `.png` lands in your
bucket as `image/png` rather than `application/octet-stream` — which is the
difference between a browser rendering the file and downloading it.

```ts
await storage().put("avatars/1.png", bytes); // stored as image/png
```

Pass `WriteOptions` to set it yourself, along with the rest of the object's
metadata:

```ts
await storage().put("exports/report.csv", csv, {
  contentType: "text/csv",
  cacheControl: "public, max-age=3600",
  visibility: "private", // needs a signed URL to read
  metadata: { uploadedBy: "42" }, // arbitrary user metadata
});
```

A disk that can't express one of these ignores it.

## Inspecting, copying, moving

```ts
const meta = await storage().metadata("avatars/1.png");
// { size, contentType, cacheControl, visibility, lastModified, metadata }

const size = await storage().size("avatars/1.png"); // number | null

await storage().copy("avatars/1.png", "avatars/1-backup.png");
await storage().move("tmp/upload.png", "avatars/2.png");
```

`copy` and `move` use the backend's server-side operation when the disk provides
one, and fall back to read-then-write otherwise. `metadata` falls back to reading
the file and measuring it.

## Signed URLs

`url()` is the *public* URL. For a private file, hand out a **temporary** one
instead:

```ts
const url = await storage().signedUrl("invoices/42.pdf", { expiresIn: 300 });
// → /storage/invoices/42.pdf?expires=1752278400&signature=a3f1…
```

How it's signed depends on the disk:

- **A disk with backend presigning** (S3, R2, GCS — see the recipes below) returns
  the backend's own presigned URL. The file is served straight from the bucket;
  your app isn't in the path at all.
- **Any other disk** gets a URL signed with `config('app.key')`, pointing at your
  app. Serve those with `serveStorage({ signed: true })`.

Either way the URL expires, and tampering with the path invalidates it.

### Serving files from a disk

`serveStorage()` is the middleware that makes app-signed URLs real — it serves a
disk's files over HTTP, verifying the signature when you ask it to. Requests that
don't match `basePath`, or that name a file the disk doesn't have, fall through
to your routes.

```ts
// in a service provider's boot(), or your HTTP kernel's constructor
const kernel = this.app.make(HttpKernel);
kernel.use(serveStorage()); // public files under /storage
kernel.use(serveStorage({ basePath: "/private", signed: true }));
```

In `signed` mode an unsigned or expired request gets a **403**. Files are sent
with their stored content type, an `ETag` (so conditional requests get a 304),
and their `Cache-Control`.

The signature covers the **path and query, not the host** — so the same signed URL
stays valid behind a CDN hostname, and you can't move a signature onto a different
file.

> **The disk's `url()` prefix and `basePath` must agree.** `signedUrl()` signs the
> path the *disk* reports, so if the disk hands out `/storage/…` while
> `serveStorage` listens on `/private`, every signed URL will 403. Give the disk
> the matching base — `new MemoryDisk("/private")`, or `localDisk("./storage",
> "/private")` — or keep both on the default `/storage`.

## Direct browser uploads

Proxying a large upload through your app is exactly what you don't want on the
edge — a 50 MB video shouldn't stream through a Worker. A **signed upload URL** lets
the browser `PUT` the file straight to the bucket:

```ts
// server
const url = await storage("r2").signedUploadUrl("uploads/clip.mp4", {
  expiresIn: 600,
  contentType: "video/mp4",
});
```

```ts
// browser
await fetch(url, {
  method: "PUT",
  body: file,
  headers: { "Content-Type": "video/mp4" },
});
```

Only the storage backend can accept such a write, so this needs a disk that
implements `signedUploadUrl` — there is no generic fallback, and calling it on one
that doesn't (the memory disk, say) throws a clear error rather than quietly
handing you a URL that won't work.

## Testing

`fakeDisk()` swaps a disk for an in-memory one, so tests never touch a real
bucket, and gives you assertions over what was written. `restoreDisk()` puts the
real one back.

```ts
import { fakeDisk, restoreDisk } from "@shaferllc/keel/core";

const disk = fakeDisk(); // or fakeDisk("r2") for a named disk

await request.post("/avatars", form);

await disk.assertExists("avatars/1.png");
await disk.assertMissing("avatars/2.png");
await disk.assertContents("notes/todo.md", "buy milk");
await disk.assertCount(1, "avatars/"); // files under a prefix

restoreDisk(); // no name → restore every faked disk
```

Failed assertions throw with the path and what was actually there.

## Multiple disks

Register disks by name and pick one with `storage(name)`:

```ts
setDisk(localDisk("./storage"), "local");
setDisk(r2Disk(env.BUCKET), "r2");

await storage("local").put("cache/x", data);
await storage("r2").put("public/logo.svg", svg);
```

## Writing a disk

A disk is the `Disk` interface. Six methods are required — `put` / `get` /
`exists` / `delete` / `list` / `url` — and the rest are **optional capabilities**:
implement `metadata`, `copy`, `move`, `signedUrl`, or `signedUploadUrl` when your
backend can do better than the generic fallback, and `Storage` will use them.

### Local filesystem (Node)

```ts
import { mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Disk } from "@shaferllc/keel/core";

const localDisk = (root: string, baseUrl = "/storage"): Disk => ({
  async put(path, bytes) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  },
  async get(path) {
    try {
      return new Uint8Array(await readFile(join(root, path)));
    } catch {
      return null;
    }
  },
  async exists(path) {
    return (await this.get(path)) !== null;
  },
  async delete(path) {
    await rm(join(root, path), { force: true });
  },
  async list(prefix = "") {
    const all = await readdir(root, { recursive: true });
    return all.filter((p) => p.startsWith(prefix));
  },
  async metadata(path) {
    const s = await stat(join(root, path)).catch(() => null);
    return s ? { size: s.size, lastModified: s.mtime } : null;
  },
  url: (path) => `${baseUrl}/${path}`,
});
```

This disk has no backend presigning, so `signedUrl()` falls back to an app-signed
URL — pair it with `serveStorage({ signed: true })`.

### Cloudflare R2 (edge, via the binding)

```ts
import type { Disk } from "@shaferllc/keel/core";

const r2Disk = (bucket: R2Bucket, baseUrl: string): Disk => ({
  async put(path, bytes, options) {
    await bucket.put(path, bytes, {
      httpMetadata: {
        contentType: options?.contentType,
        cacheControl: options?.cacheControl,
      },
      customMetadata: options?.metadata,
    });
  },
  async get(path) {
    const obj = await bucket.get(path);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  },
  async exists(path) {
    return (await bucket.head(path)) !== null;
  },
  async delete(path) {
    await bucket.delete(path);
  },
  async list(prefix) {
    const { objects } = await bucket.list({ prefix });
    return objects.map((o) => o.key);
  },
  async metadata(path) {
    const obj = await bucket.head(path);
    if (!obj) return null;
    return {
      size: obj.size,
      contentType: obj.httpMetadata?.contentType,
      cacheControl: obj.httpMetadata?.cacheControl,
      lastModified: obj.uploaded,
      metadata: obj.customMetadata,
    };
  },
  url: (path) => `${baseUrl}/${path}`,
});
```

The R2 binding writes through the Worker, so it can't presign. For direct browser
uploads, use R2's S3-compatible API below.

### S3 / R2 presigned URLs

S3 and R2 speak the same SigV4-signed HTTP API, so one disk covers both, and it's
the disk that gives you `signedUrl` and `signedUploadUrl` for real. Sign with
[`aws4fetch`](https://github.com/mhart/aws4fetch) — a ~2 KB library that runs on
Workers because it's built on Web Crypto:

```ts
import { AwsClient } from "aws4fetch";
import type { Disk } from "@shaferllc/keel/core";

const s3Disk = (options: {
  endpoint: string; // https://<account>.r2.cloudflarestorage.com/<bucket>
  accessKeyId: string;
  secretAccessKey: string;
  baseUrl: string; // your public bucket / CDN origin
}): Disk => {
  const aws = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: "s3",
  });
  const object = (path: string) => `${options.endpoint}/${path}`;

  /** A SigV4 URL with the credentials in the query string, valid for `expiresIn`. */
  const presign = async (path: string, method: string, expiresIn: number, contentType?: string) => {
    const url = new URL(object(path));
    url.searchParams.set("X-Amz-Expires", String(expiresIn));
    const signed = await aws.sign(new Request(url, { method, headers: contentType ? { "Content-Type": contentType } : {} }), {
      aws: { signQuery: true },
    });
    return signed.url;
  };

  return {
    async put(path, bytes, opts) {
      await aws.fetch(object(path), {
        method: "PUT",
        body: bytes,
        headers: {
          "Content-Type": opts?.contentType ?? "application/octet-stream",
          ...(opts?.cacheControl ? { "Cache-Control": opts.cacheControl } : {}),
        },
      });
    },
    async get(path) {
      const res = await aws.fetch(object(path));
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async exists(path) {
      return (await aws.fetch(object(path), { method: "HEAD" })).ok;
    },
    async delete(path) {
      await aws.fetch(object(path), { method: "DELETE" });
    },
    async list(prefix = "") {
      const url = new URL(options.endpoint);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      const xml = await (await aws.fetch(url)).text();
      return [...xml.matchAll(/<Key>(.*?)<\/Key>/g)].map((m) => m[1]!);
    },
    async metadata(path) {
      const res = await aws.fetch(object(path), { method: "HEAD" });
      if (!res.ok) return null;
      return {
        size: Number(res.headers.get("Content-Length") ?? 0),
        contentType: res.headers.get("Content-Type") ?? undefined,
        cacheControl: res.headers.get("Cache-Control") ?? undefined,
        lastModified: new Date(res.headers.get("Last-Modified") ?? Date.now()),
      };
    },
    url: (path) => `${options.baseUrl}/${path}`,

    // The capabilities that matter: the bucket signs, so the bytes skip your app.
    signedUrl: (path, o) => presign(path, "GET", o?.expiresIn ?? 3600),
    signedUploadUrl: (path, o) => presign(path, "PUT", o?.expiresIn ?? 3600, o?.contentType),
  };
};
```

## API reference

### `storage(name?)`

`storage(name?: string): Storage`

The default disk, or a named one registered with `setDisk(disk, name)`. Throws
for an unknown name.

### `setDisk(disk, name?)`

`setDisk(disk: Disk, name?: string): Storage`

Registers a disk (default name `"default"`) and returns the wrapping `Storage`.

### `Storage`

Wraps a `Disk`.

| Method | Signature |
|--------|-----------|
| `put` | `(path, contents: string \| Uint8Array \| ArrayBuffer, options?: WriteOptions) => Promise<void>` |
| `get` | `(path) => Promise<Uint8Array \| null>` |
| `getText` | `(path) => Promise<string \| null>` |
| `exists` / `delete` | `(path) => Promise<boolean>` / `Promise<void>` |
| `list` | `(prefix?) => Promise<string[]>` |
| `metadata` | `(path) => Promise<FileMetadata \| null>` |
| `size` | `(path) => Promise<number \| null>` |
| `copy` / `move` | `(from, to) => Promise<void>` |
| `url` | `(path) => string` — the public URL |
| `signedUrl` | `(path, options?: SignedFileOptions) => Promise<string>` |
| `signedUploadUrl` | `(path, options?: SignedUploadOptions) => Promise<string>` |
| `driver` | the underlying `Disk` |

### `fakeDisk(name?)` / `restoreDisk(name?)`

`fakeDisk(name?: string): FakeStorage` swaps a disk for an in-memory
`FakeStorage`. `restoreDisk(name?)` puts the real one back — with no name, every
faked disk.

`FakeStorage` is a `Storage` plus `assertExists(path)`, `assertMissing(path)`,
`assertContents(path, text)`, and `assertCount(n, prefix?)`.

### `serveStorage(options?)`

`serveStorage(options?: ServeStorageOptions): MiddlewareHandler`

Serves a disk's files over HTTP. Options: `disk` (name, default `"default"`),
`basePath` (default `"/storage"`), `signed` (require a valid signature, 403
otherwise), `maxAge` (`Cache-Control` seconds).

### `signStorageUrl(url, expiresIn?)` / `verifyStorageUrl(url)`

`signStorageUrl(url: string, expiresIn?: number): Promise<string>` adds `expires`
and `signature` params, signed with `config('app.key')` (default one hour).
`verifyStorageUrl(url: string): Promise<boolean>` checks them. Signing covers the
path and query, not the host.

### `contentTypeFor(path)`

`contentTypeFor(path: string): string` — the MIME type for a path's extension, or
`application/octet-stream`.

### `MemoryDisk`

`class MemoryDisk implements Disk` — in-memory, the default and ideal for tests.
`new MemoryDisk(baseUrl?)` sets the `url()` prefix. Not shared across processes.

### Interfaces & types

#### `Disk`

The driver seam. Required: `put` / `get` / `exists` / `delete` / `list` / `url`.
Optional capabilities: `metadata` / `copy` / `move` / `signedUrl` /
`signedUploadUrl`.

#### `WriteOptions`

`{ contentType?, cacheControl?, visibility?, metadata? }` — passed to `put`.

#### `FileMetadata`

`{ size, contentType?, cacheControl?, visibility?, lastModified?, metadata? }`.

#### `SignedFileOptions` / `SignedUploadOptions`

`{ expiresIn? }` (seconds, default 3600), plus `contentType?` for uploads.

#### `FileVisibility`

`type FileVisibility = "public" | "private"`.

#### `Contents`

`type Contents = string | Uint8Array | ArrayBuffer` — accepted by `put`.
