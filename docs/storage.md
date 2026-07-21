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
For production, see [the shipped disks](#the-shipped-disks) — the local
filesystem, S3-compatible buckets, and Cloudflare R2.

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

- **A disk with backend presigning** (`s3Disk`, and any disk you write with a
  `signedUrl` of its own) returns the backend's own presigned URL. The file is
  served straight from the bucket; your app isn't in the path at all.
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
> `serveStorage` listens on `/private`, no signature could ever match. Rather than
> 403 every request — which reads as "your link expired" and sends you hunting in
> the wrong place — `serveStorage` **throws** with the two paths and how to line
> them up. Give the disk the matching base (`new MemoryDisk("/private")`, or
> `localDisk({ root: "storage/app", baseUrl: "/private" })`), or keep both on the
> default `/storage`.

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
setDisk(localDisk({ root: "storage/app" }), "local");
setDisk(s3Disk({ bucket: "uploads", ...credentials }), "s3");

await storage("local").put("cache/x", data);
await storage("s3").put("public/logo.svg", svg);
```

## The shipped disks

Three disks come with Keel, each in its own entry point so nothing you don't use
is imported. Pick by where the app runs and where the bytes should live:

| Disk | Import | Runs on | Presigns? |
| --- | --- | --- | --- |
| `MemoryDisk` | `@shaferllc/keel/core` | anywhere | no (app-signed fallback) |
| `localDisk` | `@shaferllc/keel/storage/local` | Node | no (app-signed fallback) |
| `s3Disk` | `@shaferllc/keel/storage/s3` | Node + edge | **yes**, SigV4 |
| `r2Disk` | `@shaferllc/keel/storage/r2` | Workers | no (app-signed fallback) |

### `localDisk` — the local filesystem

```ts
import { localDisk } from "@shaferllc/keel/storage/local";
import { setDisk, serveStorage } from "@shaferllc/keel/core";

setDisk(localDisk({ root: "storage/app" }));
this.use(serveStorage()); // hand the files out over HTTP
```

`root` resolves from the working directory. `baseUrl` (default `/storage`) is the
prefix `url()` hands out — keep it in step with where you mount `serveStorage()`.

The filesystem has nowhere to put an object's content type or custom metadata, so
this disk stores what it can and infers the rest: `contentType` comes from the
extension on read, `visibility` maps onto the file mode (`public` → 0644,
`private` → 0600) and is read back from it, and `cacheControl` / `metadata` are
accepted and ignored — set cache headers with `serveStorage({ maxAge })` instead.

Paths that resolve outside `root` are refused, so a hostile upload filename can't
walk up into the rest of the machine.

### `s3Disk` — S3, R2, MinIO, Spaces, B2

The one that presigns. It signs its own SigV4 requests over `fetch` and Web
Crypto, imports no SDK, and runs unchanged on Node and the edge:

```ts
import { s3Disk } from "@shaferllc/keel/storage/s3";

setDisk(
  s3Disk({
    bucket: "uploads",
    region: "us-east-1",
    accessKeyId: env("AWS_ACCESS_KEY_ID"),
    secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
  }),
);
```

For R2, MinIO, or Spaces, give it the endpoint — the bucket then goes in the path
rather than the hostname, which is what those expect:

```ts
s3Disk({
  bucket: "uploads",
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  accessKeyId: env("R2_ACCESS_KEY_ID"),
  secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  publicUrl: "https://cdn.example.com", // where `url()` points
});
```

Set `publicUrl` whenever you serve files directly: without it `url()` returns the
signing endpoint, which is usually *not* publicly readable. `forcePathStyle`
overrides the addressing choice, and `sessionToken` covers temporary STS
credentials.

Because the backend signs, `signedUrl()` and `signedUploadUrl()` are real
presigned URLs rather than the app-key fallback — a browser `PUT`s straight to the
bucket and the bytes never transit your app. An upload URL signs the content type
too, so a URL minted for an image can't be reused to upload a script.

`visibility` becomes a canned ACL (`public-read` / `private`), and only when you
pass one — buckets with ACLs disabled (the modern S3 default, and R2 always)
reject the header outright.

### `r2Disk` — a Cloudflare R2 binding

When the app runs on Workers and the bucket is bound to it, the binding skips
HTTP and auth entirely:

```jsonc
// wrangler.jsonc
"r2_buckets": [{ "binding": "BUCKET", "bucket_name": "uploads" }]
```

```ts
import { r2Disk } from "@shaferllc/keel/storage/r2";

setDisk(r2Disk(env.BUCKET, { publicUrl: "https://cdn.example.com" }));
```

The binding talks to R2 over Cloudflare's internal RPC, which has no notion of a
presigned URL — so `signedUrl()` falls back to app-key signing (serve it with
`serveStorage({ signed: true })`) and `signedUploadUrl()` throws. If you need
direct browser uploads, use `s3Disk` against R2's S3 endpoint instead; it can
presign because it signs its own requests. Nothing stops you registering both:

```ts
setDisk(r2Disk(env.BUCKET), "r2"); // fast reads and writes from the Worker
setDisk(s3Disk({ ... }), "uploads"); // presigned URLs for the browser
```

## Writing a disk

A disk is the `Disk` interface. Six methods are required — `put` / `get` /
`exists` / `delete` / `list` / `url` — and the rest are **optional capabilities**:
implement `metadata`, `copy`, `move`, `signedUrl`, or `signedUploadUrl` when your
backend can do better than the generic fallback, and `Storage` will use them.

```ts
import type { Disk } from "@shaferllc/keel/core";

const gcsDisk = (bucket: string): Disk => ({
  async put(path, bytes, options) {
    /* … */
  },
  async get(path) {
    /* … return null when missing */
  },
  async exists(path) {
    /* … */
  },
  async delete(path) {
    /* … */
  },
  async list(prefix = "") {
    /* … */
  },
  url: (path) => `https://storage.googleapis.com/${bucket}/${path}`,
});
```

The three shipped disks are worth reading as worked examples —
`src/storage/local.ts` for the filesystem shape, `src/storage/s3.ts` for a
signing HTTP backend, and `src/storage/r2.ts` for a duck-typed platform binding.

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

### `localDisk(options)`

`localDisk(options: LocalDiskOptions): Disk` — from `@shaferllc/keel/storage/local`.

`LocalDiskOptions` is `{ root, baseUrl?, publicMode?, privateMode? }`. `root` is
required and resolves from the working directory; `baseUrl` defaults to
`"/storage"`; the modes default to `0o644` and `0o600` and are how `visibility` is
stored and read back. Implements `metadata`, `copy`, and `move`; no presigning.

### `s3Disk(options)`

`s3Disk(options: S3DiskOptions): Disk` — from `@shaferllc/keel/storage/s3`.

`S3DiskOptions` is `{ bucket, accessKeyId, secretAccessKey, region?, sessionToken?,
endpoint?, forcePathStyle?, publicUrl?, fetch? }`. `region` defaults to `"auto"`;
`endpoint` defaults to the AWS host for the region and, when set, flips
`forcePathStyle` on. `publicUrl` is what `url()` returns. `fetch` overrides the
global for tests or a Worker's bound fetcher.

Implements every optional capability, presigning included. `list()` follows the
ListObjectsV2 continuation token, so it doesn't truncate at 1000 keys.

### `r2Disk(bucket, options?)`

`r2Disk(bucket: R2BucketLike, options?: R2DiskOptions): Disk` — from
`@shaferllc/keel/storage/r2`.

`bucket` is duck-typed against the R2 binding (`put` / `get` / `head` / `delete` /
`list`), so no Cloudflare types are imported. `R2DiskOptions` is `{ publicUrl? }`,
defaulting to `"/storage"`. Implements `metadata` and `copy`; `list()` follows the
cursor. A binding can't presign, so `signedUrl()` falls back to app-key signing and
`signedUploadUrl()` throws.

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
