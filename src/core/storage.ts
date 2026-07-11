/**
 * File storage over a pluggable `Disk` — like the database and mail layers, the
 * core imports no filesystem or SDK, so it runs on Node and the edge. Point a
 * disk at the local filesystem (Node), S3 (`fetch`), or a Cloudflare R2 binding;
 * `MemoryDisk` is the built-in default for tests.
 *
 *   setDisk(new MemoryDisk());                 // or setDisk(r2Disk(env.BUCKET))
 *   await storage().put("avatars/1.png", bytes);
 *   const bytes = await storage().get("avatars/1.png");
 *   const url = storage().url("avatars/1.png");
 *
 * Register several disks by name and select one with `storage("s3")`.
 */

/** The bridge to a storage backend — implement it once per backend. */
export interface Disk {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  /** Paths currently stored, optionally filtered to those under `prefix`. */
  list(prefix?: string): Promise<string[]>;
  /** A URL for the stored object (public or signed — the disk decides). */
  url(path: string): string;
}

export type Contents = string | Uint8Array | ArrayBuffer;

function toBytes(contents: Contents): Uint8Array {
  if (typeof contents === "string") return new TextEncoder().encode(contents);
  if (contents instanceof Uint8Array) return contents;
  return new Uint8Array(contents);
}

/* ------------------------------ memory disk ------------------------------- */

/** An in-memory `Disk` — the default; ideal for tests. Not shared across processes. */
export class MemoryDisk implements Disk {
  private files = new Map<string, Uint8Array>();

  constructor(private baseUrl = "/storage") {}

  async put(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }
  async get(path: string): Promise<Uint8Array | null> {
    return this.files.get(path) ?? null;
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  }
  url(path: string): string {
    return `${this.baseUrl}/${path}`;
  }
}

/* -------------------------------- storage --------------------------------- */

export class Storage {
  constructor(private disk: Disk) {}

  /** Write a file (string, bytes, or ArrayBuffer — strings are UTF-8 encoded). */
  put(path: string, contents: Contents): Promise<void> {
    return this.disk.put(path, toBytes(contents));
  }

  /** Read a file's raw bytes, or null if it doesn't exist. */
  get(path: string): Promise<Uint8Array | null> {
    return this.disk.get(path);
  }

  /** Read a file as UTF-8 text, or null if it doesn't exist. */
  async getText(path: string): Promise<string | null> {
    const bytes = await this.disk.get(path);
    return bytes == null ? null : new TextDecoder().decode(bytes);
  }

  exists(path: string): Promise<boolean> {
    return this.disk.exists(path);
  }
  delete(path: string): Promise<void> {
    return this.disk.delete(path);
  }
  list(prefix?: string): Promise<string[]> {
    return this.disk.list(prefix);
  }
  url(path: string): string {
    return this.disk.url(path);
  }

  /** The underlying driver, for backend-specific operations. */
  get driver(): Disk {
    return this.disk;
  }
}

/* -------------------------------- global ---------------------------------- */

const disks = new Map<string, Storage>([["default", new Storage(new MemoryDisk())]]);

/** Register a disk, optionally under a name (default: `"default"`). */
export function setDisk(disk: Disk, name = "default"): Storage {
  const store = new Storage(disk);
  disks.set(name, store);
  return store;
}

/** The default disk, or a named one registered with `setDisk(disk, name)`. */
export function storage(name = "default"): Storage {
  const store = disks.get(name);
  if (!store) throw new Error(`No storage disk named "${name}". Register it with setDisk().`);
  return store;
}
