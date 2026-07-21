/**
 * A `Disk` for any S3-compatible bucket — AWS S3, Cloudflare R2, MinIO,
 * DigitalOcean Spaces, Backblaze B2 — over `fetch` and Web Crypto. It imports no
 * SDK, so it runs unchanged on Node and on the edge, and it signs its own
 * requests (SigV4), which is what makes presigned upload URLs possible.
 *
 *   import { s3Disk } from "@shaferllc/keel/storage/s3";
 *   import { setDisk } from "@shaferllc/keel/core";
 *
 *   setDisk(s3Disk({
 *     bucket: "uploads",
 *     region: "us-east-1",
 *     accessKeyId: env("AWS_ACCESS_KEY_ID"),
 *     secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
 *   }));
 *
 * For R2, point it at the account endpoint and use `"auto"` as the region:
 *
 *   s3Disk({
 *     bucket: "uploads",
 *     endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
 *     accessKeyId: env("R2_ACCESS_KEY_ID"),
 *     secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
 *     publicUrl: "https://cdn.example.com",   // the bucket's public domain
 *   });
 *
 * Because the backend can presign, `storage().signedUrl()` and
 * `storage().signedUploadUrl()` both hit S3's own signing rather than Keel's
 * app-key fallback — a browser can `PUT` straight to the bucket and the bytes
 * never transit your app.
 */

import type {
  Disk,
  FileMetadata,
  SignedFileOptions,
  SignedUploadOptions,
  WriteOptions,
} from "../core/storage.js";
import { contentTypeFor } from "../core/storage.js";

export interface S3DiskOptions {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Signing region. Default: `"auto"` (what R2 wants); AWS needs the real one. */
  region?: string;
  /** For temporary STS credentials. */
  sessionToken?: string;
  /**
   * The service endpoint, e.g. `https://<account>.r2.cloudflarestorage.com`.
   * Omit for AWS, where it's derived from the region.
   */
  endpoint?: string;
  /**
   * Put the bucket in the path (`endpoint/bucket/key`) rather than the host
   * (`bucket.endpoint/key`). Defaults to true when `endpoint` is set — the shape
   * R2 and MinIO expect — and false on AWS.
   */
  forcePathStyle?: boolean;
  /**
   * The base URL `url()` hands out for public objects — a CDN or the bucket's
   * public domain. Defaults to the signing endpoint, which is usually *not*
   * publicly readable, so set this if you serve files directly.
   */
  publicUrl?: string;
  /** Override `fetch` (for tests, or a Worker's bound fetcher). */
  fetch?: typeof fetch;
}

/* ------------------------------ sigv4 helpers ------------------------------ */

const encoder = new TextEncoder();
const UNSIGNED = "UNSIGNED-PAYLOAD";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `crypto.subtle` and `fetch` both want a plain `ArrayBuffer`, but a `Uint8Array`
 * may be a view onto a larger one — so copy out exactly the bytes we mean.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes))));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)));
}

/**
 * RFC 3986 encoding, which is stricter than `encodeURIComponent` — S3 signs the
 * encoded path, so `!'()*` have to be escaped too or the signature won't match.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode an object key for a URL path — every segment escaped, the slashes kept. */
function encodeKey(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

/** `20260721T134500Z` and `20260721`, the two forms SigV4 asks for. */
function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** Canonical query string: sorted by encoded name, every value encoded. */
function canonicalQuery(params: URLSearchParams): string {
  return [...params]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/* --------------------------------- parsing --------------------------------- */

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&"); // last, so `&amp;lt;` doesn't become `<`
}

function xmlTagValues(xml: string, tag: string): string[] {
  const matches = xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"));
  return [...matches].map((m) => decodeXmlEntities(m[1] ?? ""));
}

/* ---------------------------------- disk ----------------------------------- */

export function s3Disk(options: S3DiskOptions): Disk {
  const {
    bucket,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region = "auto",
    endpoint,
    publicUrl,
  } = options;
  const doFetch = options.fetch ?? fetch;

  const pathStyle = options.forcePathStyle ?? Boolean(endpoint);
  const base = (endpoint ?? `https://s3.${region}.amazonaws.com`).replace(/\/+$/, "");

  /** The URL a request for `key` goes to, path- or virtual-host-style. */
  function objectUrl(key: string): URL {
    if (pathStyle) return new URL(`${base}/${uriEncode(bucket)}/${encodeKey(key)}`);
    const url = new URL(base);
    url.hostname = `${bucket}.${url.hostname}`;
    url.pathname = `/${encodeKey(key)}`;
    return url;
  }

  /** The bucket root — where `list` sends its ListObjectsV2 query. */
  function bucketUrl(): URL {
    if (pathStyle) return new URL(`${base}/${uriEncode(bucket)}`);
    const url = new URL(base);
    url.hostname = `${bucket}.${url.hostname}`;
    return url;
  }

  async function signingKey(dateStamp: string): Promise<Uint8Array> {
    let key = encoder.encode(`AWS4${secretAccessKey}`);
    for (const part of [dateStamp, region, "s3", "aws4_request"]) key = await hmac(key, part);
    return key;
  }

  /**
   * Sign a request with SigV4 in the `Authorization` header, returning the
   * headers to send. The payload hash goes in `x-amz-content-sha256`, which S3
   * requires on every signed request.
   */
  async function signHeaders(
    method: string,
    url: URL,
    headers: Record<string, string>,
    payloadHash: string,
  ): Promise<Record<string, string>> {
    const { amzDate, dateStamp } = stamps(new Date());
    const scope = `${dateStamp}/${region}/s3/aws4_request`;

    const all: Record<string, string> = {
      ...headers,
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
    };

    const names = Object.keys(all)
      .map((n) => n.toLowerCase())
      .sort();
    const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v]));
    const canonicalHeaders = names.map((n) => `${n}:${String(lower[n]).trim()}\n`).join("");
    const signedHeaders = names.join(";");

    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery(url.searchParams),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const toSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      await sha256(canonicalRequest),
    ].join("\n");

    const signature = hex(await hmac(await signingKey(dateStamp), toSign));

    return {
      ...all,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  /**
   * Sign a URL with the signature in the query string, so a browser can use it
   * with no headers of its own. The payload is left unsigned — the whole point
   * is that we don't have the bytes the client will send.
   */
  async function presign(
    method: string,
    url: URL,
    expiresIn: number,
    signedHeaders: Record<string, string> = {},
  ): Promise<string> {
    const { amzDate, dateStamp } = stamps(new Date());
    const scope = `${dateStamp}/${region}/s3/aws4_request`;

    const all: Record<string, string> = { ...signedHeaders, host: url.host };
    const names = Object.keys(all)
      .map((n) => n.toLowerCase())
      .sort();
    const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v]));
    const canonicalHeaders = names.map((n) => `${n}:${String(lower[n]).trim()}\n`).join("");
    const signedHeaderList = names.join(";");

    const signed = new URL(url);
    signed.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    signed.searchParams.set("X-Amz-Credential", `${accessKeyId}/${scope}`);
    signed.searchParams.set("X-Amz-Date", amzDate);
    signed.searchParams.set("X-Amz-Expires", String(expiresIn));
    signed.searchParams.set("X-Amz-SignedHeaders", signedHeaderList);
    if (sessionToken) signed.searchParams.set("X-Amz-Security-Token", sessionToken);

    const canonicalRequest = [
      method,
      signed.pathname,
      canonicalQuery(signed.searchParams),
      canonicalHeaders,
      signedHeaderList,
      UNSIGNED,
    ].join("\n");

    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join("\n");
    const signature = hex(await hmac(await signingKey(dateStamp), toSign));

    signed.searchParams.set("X-Amz-Signature", signature);
    return signed.toString();
  }

  /** Issue a signed request and fail loudly on anything that isn't a 2xx. */
  async function send(
    method: string,
    url: URL,
    init: { headers?: Record<string, string>; body?: Uint8Array } = {},
    allow404 = false,
  ): Promise<Response> {
    const body = init.body;
    const payloadHash = body ? await sha256(body) : await sha256("");
    const headers = await signHeaders(method, url, init.headers ?? {}, payloadHash);

    const response = await doFetch(url.toString(), {
      method,
      headers,
      ...(body ? { body: toArrayBuffer(body) } : {}),
    });

    if (response.ok || (allow404 && response.status === 404)) return response;

    const detail = await response.text().catch(() => "");
    throw new Error(
      `S3 ${method} ${url.pathname} failed: ${response.status} ${response.statusText}` +
        (detail ? `\n${detail}` : ""),
    );
  }

  /**
   * A server-side copy — the bytes never come to us. The source is
   * bucket-qualified and encoded the same way an object path is.
   */
  async function copyObject(from: string, to: string): Promise<void> {
    await send("PUT", objectUrl(to), {
      headers: { "x-amz-copy-source": `/${bucket}/${encodeKey(from)}` },
    });
  }

  return {
    async put(path, bytes, write: WriteOptions = {}): Promise<void> {
      const headers: Record<string, string> = {
        "content-type": write.contentType ?? contentTypeFor(path),
        "content-length": String(bytes.byteLength),
      };
      if (write.cacheControl) headers["cache-control"] = write.cacheControl;
      // S3 has no per-object "visibility" — it has canned ACLs. Buckets with ACLs
      // disabled (the modern default, and R2 always) reject the header outright,
      // so only send it when the caller asked for something.
      if (write.visibility) headers["x-amz-acl"] = write.visibility === "public" ? "public-read" : "private";
      for (const [key, value] of Object.entries(write.metadata ?? {})) {
        headers[`x-amz-meta-${key.toLowerCase()}`] = value;
      }

      await send("PUT", objectUrl(path), { headers, body: bytes });
    },

    async get(path): Promise<Uint8Array | null> {
      const response = await send("GET", objectUrl(path), {}, true);
      if (response.status === 404) return null;
      return new Uint8Array(await response.arrayBuffer());
    },

    async exists(path): Promise<boolean> {
      const response = await send("HEAD", objectUrl(path), {}, true);
      return response.status !== 404;
    },

    async delete(path): Promise<void> {
      await send("DELETE", objectUrl(path), {}, true);
    },

    async list(prefix = ""): Promise<string[]> {
      const keys: string[] = [];
      let token: string | undefined;

      // ListObjectsV2 caps a page at 1000 keys, so follow the continuation token
      // until the bucket says it's done — otherwise `list()` quietly truncates.
      do {
        const url = bucketUrl();
        url.searchParams.set("list-type", "2");
        if (prefix) url.searchParams.set("prefix", prefix);
        if (token) url.searchParams.set("continuation-token", token);

        const xml = await (await send("GET", url)).text();
        keys.push(...xmlTagValues(xml, "Key"));
        token =
          xmlTagValues(xml, "IsTruncated")[0] === "true"
            ? xmlTagValues(xml, "NextContinuationToken")[0]
            : undefined;
      } while (token);

      return keys.sort();
    },

    url(path): string {
      if (publicUrl) return `${publicUrl.replace(/\/+$/, "")}/${encodeKey(path)}`;
      return objectUrl(path).toString();
    },

    async metadata(path): Promise<FileMetadata | null> {
      const response = await send("HEAD", objectUrl(path), {}, true);
      if (response.status === 404) return null;

      const metadata: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (name.toLowerCase().startsWith("x-amz-meta-")) metadata[name.slice(11)] = value;
      });

      const modified = response.headers.get("last-modified");
      return {
        size: Number(response.headers.get("content-length") ?? 0),
        contentType: response.headers.get("content-type") ?? contentTypeFor(path),
        cacheControl: response.headers.get("cache-control") ?? undefined,
        lastModified: modified ? new Date(modified) : undefined,
        metadata: Object.keys(metadata).length ? metadata : undefined,
      };
    },

    copy: copyObject,

    async move(from, to): Promise<void> {
      await copyObject(from, to);
      await send("DELETE", objectUrl(from), {}, true);
    },

    async signedUrl(path, signed: SignedFileOptions = {}): Promise<string> {
      return presign("GET", objectUrl(path), signed.expiresIn ?? 3600);
    },

    async signedUploadUrl(path, upload: SignedUploadOptions = {}): Promise<string> {
      // Signing `content-type` binds the URL to that type: the browser must send
      // the same header or S3 rejects the PUT. That's the guarantee you want —
      // a URL minted for an image can't be used to upload a script.
      const contentType = upload.contentType ?? contentTypeFor(path);
      return presign("PUT", objectUrl(path), upload.expiresIn ?? 3600, {
        "content-type": contentType,
      });
    },
  };
}
