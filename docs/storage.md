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
const url = storage().url("avatars/1.png"); // a URL for the object
```

The default disk is a `MemoryDisk`, so `storage()` works out of the box in tests.

## Multiple disks

Register disks by name and pick one with `storage(name)`:

```ts
setDisk(localDisk("./storage"), "local");
setDisk(r2Disk(env.BUCKET), "r2");

await storage("local").put("cache/x", data);
await storage("r2").put("public/logo.svg", svg);
```

## Writing a disk

A disk is the `Disk` interface — `put` / `get` / `exists` / `delete` / `list` /
`url`. Here are the three you'll actually use.

### Local filesystem (Node)

```ts
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
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
  url: (path) => `${baseUrl}/${path}`,
});
```

### Cloudflare R2 (edge)

```ts
import type { Disk } from "@shaferllc/keel/core";

const r2Disk = (bucket: R2Bucket, baseUrl: string): Disk => ({
  async put(path, bytes) {
    await bucket.put(path, bytes);
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
  url: (path) => `${baseUrl}/${path}`,
});
```

S3 follows the same shape over `fetch` (signed requests) or the AWS SDK.

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
| `put` | `(path, contents: string \| Uint8Array \| ArrayBuffer) => Promise<void>` |
| `get` | `(path) => Promise<Uint8Array \| null>` |
| `getText` | `(path) => Promise<string \| null>` |
| `exists` / `delete` | `(path) => Promise<boolean>` / `Promise<void>` |
| `list` | `(prefix?) => Promise<string[]>` |
| `url` | `(path) => string` |
| `driver` | the underlying `Disk` |

### `MemoryDisk`

`class MemoryDisk implements Disk` — in-memory, the default and ideal for tests.
`new MemoryDisk(baseUrl?)` sets the `url()` prefix. Not shared across processes.

### Interfaces & types

#### `Disk`

The driver seam: `put` / `get` / `exists` / `delete` / `list` / `url`.

#### `Contents`

`type Contents = string | Uint8Array | ArrayBuffer` — accepted by `put`.
