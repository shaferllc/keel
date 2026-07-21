/**
 * A `Disk` backed by a Cloudflare R2 *binding* — the zero-latency, zero-auth
 * path when your app runs on Workers and the bucket is bound to it:
 *
 *   // wrangler.jsonc: "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "uploads" }]
 *   import { r2Disk } from "@shaferllc/keel/storage/r2";
 *   import { setDisk } from "@shaferllc/keel/core";
 *
 *   setDisk(r2Disk(env.BUCKET, { publicUrl: "https://cdn.example.com" }));
 *
 * The binding is duck-typed, so this module imports no Cloudflare types and
 * bundles nothing.
 *
 * A binding talks to R2 over Cloudflare's internal RPC, which has no notion of a
 * presigned URL — so `signedUrl()` falls back to signing the disk's own URL with
 * `config('app.key')` (serve it with `serveStorage({ signed: true })`), and
 * `signedUploadUrl()` is unavailable. If you need browsers to upload straight to
 * the bucket, use `s3Disk` against R2's S3 endpoint instead — it can presign
 * because it signs its own requests.
 */

import type { Disk, FileMetadata, WriteOptions } from "../core/storage.js";
import { contentTypeFor } from "../core/storage.js";

/** What R2 stores alongside an object's bytes. */
export interface R2HttpMetadata {
  contentType?: string;
  cacheControl?: string;
}

/** The slice of an `R2Object` this adapter reads. */
export interface R2ObjectLike {
  key: string;
  size: number;
  uploaded?: Date;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The slice of the R2 binding API this adapter uses. */
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: R2HttpMetadata; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }>;
}

export interface R2DiskOptions {
  /**
   * The base URL `url()` hands out — the bucket's public r2.dev domain, or the
   * custom domain in front of it. Default: `"/storage"`, i.e. served by your own
   * app through `serveStorage()`.
   */
  publicUrl?: string;
}

export function r2Disk(bucket: R2BucketLike, options: R2DiskOptions = {}): Disk {
  const baseUrl = (options.publicUrl ?? "/storage").replace(/\/+$/, "");

  function toMetadata(object: R2ObjectLike): FileMetadata {
    return {
      size: object.size,
      contentType: object.httpMetadata?.contentType ?? contentTypeFor(object.key),
      cacheControl: object.httpMetadata?.cacheControl,
      lastModified: object.uploaded,
      metadata: object.customMetadata,
    };
  }

  return {
    async put(path, bytes, write: WriteOptions = {}): Promise<void> {
      await bucket.put(path, bytes, {
        httpMetadata: {
          contentType: write.contentType ?? contentTypeFor(path),
          ...(write.cacheControl ? { cacheControl: write.cacheControl } : {}),
        },
        ...(write.metadata ? { customMetadata: write.metadata } : {}),
      });
    },

    async get(path): Promise<Uint8Array | null> {
      const object = await bucket.get(path);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },

    async exists(path): Promise<boolean> {
      return (await bucket.head(path)) !== null;
    },

    async delete(path): Promise<void> {
      await bucket.delete(path);
    },

    async list(prefix = ""): Promise<string[]> {
      const keys: string[] = [];
      let cursor: string | undefined;

      // R2 pages at 1000 objects; follow the cursor so `list()` doesn't truncate.
      do {
        const page = await bucket.list({ ...(prefix ? { prefix } : {}), ...(cursor ? { cursor } : {}) });
        keys.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);

      return keys.sort();
    },

    url(path): string {
      return `${baseUrl}/${path}`;
    },

    async metadata(path): Promise<FileMetadata | null> {
      const object = await bucket.head(path);
      return object ? toMetadata(object) : null;
    },

    async copy(from, to): Promise<void> {
      // A binding has no server-side copy, so the bytes do round-trip here. The
      // metadata comes along, which the generic read-then-write fallback in
      // `Storage.copy()` would also do — but doing it here saves a second HEAD.
      const object = await bucket.get(from);
      if (!object) throw new Error(`Cannot copy "${from}": no such file.`);

      await bucket.put(to, await object.arrayBuffer(), {
        httpMetadata: object.httpMetadata ?? { contentType: contentTypeFor(to) },
        ...(object.customMetadata ? { customMetadata: object.customMetadata } : {}),
      });
    },
  };
}
