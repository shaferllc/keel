/**
 * A `Disk` backed by the local filesystem — the default for a Node app in
 * development, and fine in production behind a single server or a shared volume.
 *
 *   import { localDisk } from "@shaferllc/keel/storage/local";
 *   import { setDisk, serveStorage } from "@shaferllc/keel/core";
 *
 *   setDisk(localDisk({ root: "storage/app" }));
 *   this.use(serveStorage());          // hand the files out over HTTP
 *
 * The filesystem has nowhere to keep an object's content type, cache header, or
 * custom metadata, so this disk stores what it can and infers the rest:
 *
 *   - `contentType` is inferred from the extension on read.
 *   - `visibility` maps onto the file mode (`public` → 0644, `private` → 0600),
 *     which is the only part of `WriteOptions` the filesystem can really hold.
 *   - `cacheControl` and `metadata` are accepted and ignored — set cache headers
 *     with `serveStorage({ maxAge })` instead.
 *
 * There is no backend presigning either, so `signedUrl()` falls back to signing
 * the disk's own URL with `config('app.key')`. Serve those with
 * `serveStorage({ signed: true })`, mounted at the same `baseUrl` this disk uses.
 */

import { mkdir, readFile, writeFile, rm, rename, copyFile, stat, readdir, chmod } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";

import type { Disk, FileMetadata, FileVisibility, WriteOptions } from "../core/storage.js";
import { contentTypeFor } from "../core/storage.js";

export interface LocalDiskOptions {
  /** Directory the files live under. Relative paths resolve from `process.cwd()`. */
  root: string;
  /** URL prefix `url()` hands out. Default: `"/storage"`. */
  baseUrl?: string;
  /** Mode for `public` writes. Default: 0o644. */
  publicMode?: number;
  /** Mode for `private` writes. Default: 0o600. */
  privateMode?: number;
}

/** The mode bits that decide whether a file is world-readable. */
const OTHER_READ = 0o004;

export function localDisk(options: LocalDiskOptions): Disk {
  const root = resolve(options.root);
  const baseUrl = (options.baseUrl ?? "/storage").replace(/\/+$/, "");
  const publicMode = options.publicMode ?? 0o644;
  const privateMode = options.privateMode ?? 0o600;

  /**
   * Resolve a storage path to an absolute one, refusing anything that climbs out
   * of the root. A disk path is untrusted input — it routinely comes from a user
   * upload's filename — so `../../etc/passwd` has to fail here rather than
   * somewhere further down where it would be a real read of a real file.
   */
  function full(path: string): string {
    const target = resolve(root, path);
    const rel = relative(root, target);
    if (rel === "" || rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
      throw new Error(`Refusing to touch "${path}": it resolves outside the disk root.`);
    }
    return target;
  }

  async function statOrNull(path: string) {
    return stat(path).catch(() => null);
  }

  return {
    async put(path, bytes, write: WriteOptions = {}): Promise<void> {
      const target = full(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      await chmod(target, write.visibility === "private" ? privateMode : publicMode);
    },

    async get(path): Promise<Uint8Array | null> {
      // A missing file is a `null`, not a throw — but a permissions error or a
      // path pointing at a directory is a real problem and should surface.
      const buffer = await readFile(full(path)).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT" || err.code === "EISDIR") return null;
        throw err;
      });
      return buffer == null ? null : new Uint8Array(buffer);
    },

    async exists(path): Promise<boolean> {
      return (await statOrNull(full(path)))?.isFile() ?? false;
    },

    async delete(path): Promise<void> {
      await rm(full(path), { force: true });
    },

    async list(prefix = ""): Promise<string[]> {
      const out: string[] = [];

      async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const child = join(dir, entry.name);
          if (entry.isDirectory()) await walk(child);
          else if (entry.isFile()) out.push(relative(root, child).split(sep).join("/"));
        }
      }

      await walk(root);
      return out.filter((p) => p.startsWith(prefix)).sort();
    },

    url(path): string {
      return `${baseUrl}/${path}`;
    },

    async metadata(path): Promise<FileMetadata | null> {
      const info = await statOrNull(full(path));
      if (!info?.isFile()) return null;

      const visibility: FileVisibility = info.mode & OTHER_READ ? "public" : "private";
      return {
        size: info.size,
        contentType: contentTypeFor(path),
        visibility,
        lastModified: info.mtime,
      };
    },

    async copy(from, to): Promise<void> {
      const target = full(to);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(full(from), target);
    },

    async move(from, to): Promise<void> {
      const target = full(to);
      await mkdir(dirname(target), { recursive: true });
      await rename(full(from), target);
    },
  };
}
