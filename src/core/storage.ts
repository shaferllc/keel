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
 * Private files get a temporary URL instead of a public one:
 *
 *   await storage().signedUrl("invoices/42.pdf", { expiresIn: 300 });
 *
 * and browsers can upload straight to the bucket — the bytes never transit the
 * app — with a signed upload URL:
 *
 *   await storage().signedUploadUrl("uploads/raw.mov", { contentType: "video/quicktime" });
 *
 * Register several disks by name and select one with `storage("s3")`.
 */

import type { MiddlewareHandler } from "hono";
import { getMimeType } from "hono/utils/mime";

import { config } from "./helpers.js";
import { hmacHex, timingSafeEqual } from "./crypto.js";

/* --------------------------------- types ---------------------------------- */

/** Whether an object is world-readable or needs a signed URL. */
export type FileVisibility = "public" | "private";

/** Per-write options. Disks map these onto their backend's own metadata. */
export interface WriteOptions {
  /**
   * The object's MIME type. Inferred from the path's extension when omitted, so
   * a `.png` is stored as `image/png` rather than `application/octet-stream`.
   */
  contentType?: string;
  /** A `Cache-Control` value to store alongside the object. */
  cacheControl?: string;
  /** `"public"` or `"private"`. Disks that can't express this ignore it. */
  visibility?: FileVisibility;
  /** Arbitrary user metadata stored with the object. */
  metadata?: Record<string, string>;
}

/** What a disk knows about a stored object. */
export interface FileMetadata {
  size: number;
  contentType?: string;
  cacheControl?: string;
  visibility?: FileVisibility;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export interface SignedFileOptions {
  /** Seconds the URL stays valid. Default: 3600 (one hour). */
  expiresIn?: number;
}

export interface SignedUploadOptions extends SignedFileOptions {
  /** The `Content-Type` the uploader must send. */
  contentType?: string;
}

/**
 * The bridge to a storage backend — implement it once per backend.
 *
 * The first six methods are required. The rest are optional capabilities: a disk
 * that can do better than the generic implementation (native `HEAD`, a
 * server-side copy, backend presigning) implements them, and `Storage` uses them
 * when present.
 */
export interface Disk {
  put(path: string, bytes: Uint8Array, options?: WriteOptions): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  /** Paths currently stored, optionally filtered to those under `prefix`. */
  list(prefix?: string): Promise<string[]>;
  /** A public URL for the stored object. */
  url(path: string): string;

  /** Size, content type, and friends. `Storage.metadata()` falls back to a read. */
  metadata?(path: string): Promise<FileMetadata | null>;
  /** A server-side copy. `Storage.copy()` falls back to read-then-write. */
  copy?(from: string, to: string): Promise<void>;
  /** A server-side move. `Storage.move()` falls back to copy-then-delete. */
  move?(from: string, to: string): Promise<void>;
  /**
   * A backend-presigned read URL (S3/R2 SigV4, GCS, …). When a disk doesn't
   * implement this, `Storage.signedUrl()` signs the disk's own `url()` with
   * `config('app.key')` — serve it with `serveStorage({ signed: true })`.
   */
  signedUrl?(path: string, options?: SignedFileOptions): Promise<string>;
  /**
   * A backend-presigned upload URL, so a browser can `PUT` straight to the
   * bucket. There is no generic fallback — only the backend can accept the write.
   */
  signedUploadUrl?(path: string, options?: SignedUploadOptions): Promise<string>;
}

export type Contents = string | Uint8Array | ArrayBuffer;

function toBytes(contents: Contents): Uint8Array {
  if (typeof contents === "string") return new TextEncoder().encode(contents);
  if (contents instanceof Uint8Array) return contents;
  return new Uint8Array(contents);
}

/** The MIME type for a path's extension, or `application/octet-stream`. */
export function contentTypeFor(path: string): string {
  return getMimeType(path) ?? "application/octet-stream";
}

/* -------------------------------- signing --------------------------------- */

function appKey(): string {
  const key = config<string>("app.key", "");
  if (!key) throw new Error("Signed storage URLs require config('app.key'). Set APP_KEY.");
  return key;
}

/**
 * The string we actually sign: path + query, never the host. A disk's `url()`
 * may be absolute (a CDN) or relative (`/storage/x`), while the request that
 * comes back in is always absolute — signing only the path makes both sides
 * agree. It also means the same signature is valid across your own hostnames,
 * which is what you want behind a CDN.
 */
function canonical(url: string, params: URLSearchParams): string {
  const { pathname } = new URL(url, "http://keel.local");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Sign a URL with `config('app.key')`, adding `expires` and `signature` query
 * params. Verify it with `verifyStorageUrl()`.
 */
export async function signStorageUrl(url: string, expiresIn = 3600): Promise<string> {
  const mark = url.indexOf("?");
  const base = mark === -1 ? url : url.slice(0, mark);

  // Keep any query the disk's own url() already carries — a CDN token, say.
  const params = new URLSearchParams(mark === -1 ? "" : url.slice(mark + 1));
  params.set("expires", String(Math.floor(Date.now() / 1000) + expiresIn));

  const signature = await hmacHex(canonical(base, params), appKey());
  params.set("signature", signature);
  return `${base}?${params}`;
}

/** Whether a URL carries a valid, unexpired signature from `signStorageUrl()`. */
export async function verifyStorageUrl(url: string): Promise<boolean> {
  const parsed = new URL(url, "http://keel.local");
  const signature = parsed.searchParams.get("signature");
  if (!signature) return false;
  parsed.searchParams.delete("signature");

  const expires = Number(parsed.searchParams.get("expires"));
  if (!expires || expires < Math.floor(Date.now() / 1000)) return false;

  const expected = await hmacHex(canonical(parsed.pathname, parsed.searchParams), appKey());
  return timingSafeEqual(signature, expected);
}

/* ------------------------------ memory disk ------------------------------- */

interface MemoryEntry {
  bytes: Uint8Array;
  meta: FileMetadata;
}

/** An in-memory `Disk` — the default; ideal for tests. Not shared across processes. */
export class MemoryDisk implements Disk {
  private files = new Map<string, MemoryEntry>();

  constructor(private baseUrl = "/storage") {}

  async put(path: string, bytes: Uint8Array, options: WriteOptions = {}): Promise<void> {
    this.files.set(path, {
      bytes,
      meta: {
        size: bytes.byteLength,
        contentType: options.contentType ?? contentTypeFor(path),
        cacheControl: options.cacheControl,
        visibility: options.visibility ?? "public",
        lastModified: new Date(),
        metadata: options.metadata,
      },
    });
  }
  async get(path: string): Promise<Uint8Array | null> {
    return this.files.get(path)?.bytes ?? null;
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
  async metadata(path: string): Promise<FileMetadata | null> {
    return this.files.get(path)?.meta ?? null;
  }
  async copy(from: string, to: string): Promise<void> {
    const entry = this.files.get(from);
    if (entry) this.files.set(to, { bytes: entry.bytes, meta: { ...entry.meta } });
  }
  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    this.files.delete(from);
  }
}

/* -------------------------------- storage --------------------------------- */

export class Storage {
  constructor(private disk: Disk) {}

  /**
   * Write a file (string, bytes, or ArrayBuffer — strings are UTF-8 encoded).
   * The content type is inferred from the extension unless you pass one.
   */
  put(path: string, contents: Contents, options: WriteOptions = {}): Promise<void> {
    return this.disk.put(path, toBytes(contents), {
      ...options,
      contentType: options.contentType ?? contentTypeFor(path),
    });
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

  /** Size, content type, and friends — or null if the file doesn't exist. */
  async metadata(path: string): Promise<FileMetadata | null> {
    if (this.disk.metadata) return this.disk.metadata(path);
    const bytes = await this.disk.get(path);
    if (bytes == null) return null;
    return { size: bytes.byteLength, contentType: contentTypeFor(path) };
  }

  /** A file's size in bytes, or null if it doesn't exist. */
  async size(path: string): Promise<number | null> {
    return (await this.metadata(path))?.size ?? null;
  }

  /** Copy a file. Server-side when the disk supports it, else read-then-write. */
  async copy(from: string, to: string): Promise<void> {
    if (this.disk.copy) return this.disk.copy(from, to);
    const bytes = await this.disk.get(from);
    if (bytes == null) throw new Error(`Cannot copy "${from}": no such file.`);
    const meta = await this.metadata(from);
    await this.disk.put(to, bytes, {
      contentType: meta?.contentType ?? contentTypeFor(to),
      cacheControl: meta?.cacheControl,
      visibility: meta?.visibility,
      metadata: meta?.metadata,
    });
  }

  /** Move a file. Server-side when the disk supports it, else copy-then-delete. */
  async move(from: string, to: string): Promise<void> {
    if (this.disk.move) return this.disk.move(from, to);
    await this.copy(from, to);
    await this.disk.delete(from);
  }

  /** A public URL for the object. Use `signedUrl()` for private ones. */
  url(path: string): string {
    return this.disk.url(path);
  }

  /**
   * A temporary URL for a private object. Uses the backend's own presigning when
   * the disk implements `signedUrl` (S3, R2, GCS); otherwise signs the disk's
   * `url()` with `config('app.key')` — serve those with `serveStorage({ signed: true })`.
   */
  async signedUrl(path: string, options: SignedFileOptions = {}): Promise<string> {
    if (this.disk.signedUrl) return this.disk.signedUrl(path, options);
    return signStorageUrl(this.disk.url(path), options.expiresIn ?? 3600);
  }

  /**
   * A URL the browser can `PUT` the file to directly, so the bytes never transit
   * your app — the point of this on the edge, where proxying a large upload
   * through a Worker is exactly what you don't want.
   *
   * Only the backend can accept such a write, so this requires a disk that
   * implements `signedUploadUrl` (see the S3/R2 recipe in the storage guide).
   */
  async signedUploadUrl(path: string, options: SignedUploadOptions = {}): Promise<string> {
    if (!this.disk.signedUploadUrl) {
      throw new Error(
        "This disk does not support signed upload URLs. Implement `signedUploadUrl` on it " +
          "(the storage guide has an S3/R2 recipe) — only the storage backend can accept a direct upload.",
      );
    }
    return this.disk.signedUploadUrl(path, {
      ...options,
      contentType: options.contentType ?? contentTypeFor(path),
    });
  }

  /** The underlying driver, for backend-specific operations. */
  get driver(): Disk {
    return this.disk;
  }
}

/* --------------------------------- faking --------------------------------- */

/**
 * A `Storage` backed by a `MemoryDisk`, with assertions — what `fakeDisk()`
 * installs so tests never touch a real bucket.
 */
export class FakeStorage extends Storage {
  constructor() {
    super(new MemoryDisk());
  }

  async assertExists(path: string): Promise<void> {
    if (!(await this.exists(path))) {
      throw new Error(`Expected "${path}" to exist on the fake disk, but it does not.`);
    }
  }

  async assertMissing(path: string): Promise<void> {
    if (await this.exists(path)) {
      throw new Error(`Expected "${path}" to be missing from the fake disk, but it exists.`);
    }
  }

  /** Assert a file's contents, as UTF-8 text. */
  async assertContents(path: string, expected: string): Promise<void> {
    await this.assertExists(path);
    const actual = await this.getText(path);
    if (actual !== expected) {
      throw new Error(`Expected "${path}" to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
    }
  }

  /** Assert how many files are stored, optionally under a prefix. */
  async assertCount(expected: number, prefix?: string): Promise<void> {
    const actual = (await this.list(prefix)).length;
    if (actual !== expected) {
      const where = prefix ? ` under "${prefix}"` : "";
      throw new Error(`Expected ${expected} file(s)${where} on the fake disk, found ${actual}.`);
    }
  }
}

/* -------------------------------- global ---------------------------------- */

const disks = new Map<string, Storage>([["default", new Storage(new MemoryDisk())]]);
/** Disks displaced by `fakeDisk()`, so `restoreDisk()` can put them back. */
const realDisks = new Map<string, Storage>();

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

/**
 * Swap a disk for an in-memory `FakeStorage` so tests never touch a real bucket,
 * and assert against what was written. Undo with `restoreDisk()`.
 *
 *   const disk = fakeDisk();
 *   await request.post("/avatars", form);
 *   await disk.assertExists("avatars/1.png");
 */
export function fakeDisk(name = "default"): FakeStorage {
  const existing = disks.get(name);
  // Only remember the *real* disk — faking twice must not stash a fake.
  if (existing && !realDisks.has(name)) realDisks.set(name, existing);

  const fake = new FakeStorage();
  disks.set(name, fake);
  return fake;
}

/** Restore the real disk after `fakeDisk()`. With no name, restores them all. */
export function restoreDisk(name?: string): void {
  const names = name ? [name] : [...realDisks.keys()];
  for (const key of names) {
    const real = realDisks.get(key);
    if (real) disks.set(key, real);
    realDisks.delete(key);
  }
}

/* ------------------------------ serving files ----------------------------- */

export interface ServeStorageOptions {
  /** Which registered disk to serve from. Default: `"default"`. */
  disk?: string;
  /** URL prefix the files live under. Default: `"/storage"`. */
  basePath?: string;
  /**
   * Require a valid signature from `signedUrl()` — the private-file mode.
   * Unsigned or expired requests get a 403. Default: false.
   */
  signed?: boolean;
  /** `Cache-Control` max-age in seconds. Omit for no header. */
  maxAge?: number;
}

/**
 * Serve files from a disk over HTTP — what makes the fallback `signedUrl()` real
 * for disks without backend presigning (the memory disk, a local-filesystem
 * disk). Requests that don't match `basePath`, or that name a file the disk
 * doesn't have, fall through to your routes.
 *
 *   this.use(serveStorage());                                  // public files
 *   this.use(serveStorage({ basePath: "/private", signed: true }));
 */
export function serveStorage(options: ServeStorageOptions = {}): MiddlewareHandler {
  const basePath = (options.basePath ?? "/storage").replace(/\/+$/, "");

  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();

    const url = new URL(c.req.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return next();

    const path = decodeURIComponent(url.pathname.slice(basePath.length + 1));
    if (!path || path.includes("..")) return next(); // path traversal guard

    const store = storage(options.disk);

    if (options.signed) {
      // `signedUrl()` signs the path the *disk* reports. If the disk hands out
      // `/storage/…` while this middleware is mounted at `/private`, no signature
      // can ever match and every request would 403 — a misconfiguration that looks
      // exactly like an expired link. Say so instead of failing quietly.
      const diskPath = new URL(store.url(path), "http://keel.local").pathname;
      if (diskPath !== url.pathname) {
        throw new Error(
          `serveStorage: the disk serves "${path}" at "${diskPath}", but this middleware is ` +
            `mounted at "${url.pathname}". signedUrl() signs the disk's own URL, so no signature ` +
            `can match here. Give the disk the matching base URL (e.g. new MemoryDisk("${basePath}")) ` +
            `or set basePath to the disk's prefix.`,
        );
      }

      if (!(await verifyStorageUrl(c.req.url))) return c.text("Forbidden", 403);
    }

    const bytes = await store.get(path);
    if (bytes == null) return next();

    const meta = await store.metadata(path);
    const etag = `W/"${meta?.size ?? bytes.byteLength}-${meta?.lastModified?.getTime() ?? 0}"`;

    c.header("Content-Type", meta?.contentType ?? contentTypeFor(path));
    c.header("ETag", etag);
    if (meta?.lastModified) c.header("Last-Modified", meta.lastModified.toUTCString());

    const cacheControl =
      meta?.cacheControl ??
      (options.maxAge != null
        ? `${options.signed ? "private" : "public"}, max-age=${options.maxAge}`
        : undefined);
    if (cacheControl) c.header("Cache-Control", cacheControl);

    if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
    if (c.req.method === "HEAD") return c.body(null, 200);

    // Copy out of the view's backing buffer — `bytes.buffer` alone may be larger.
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return c.body(body as ArrayBuffer, 200);
  };
}
