// Type-check harness for docs/storage.md. Compile-only — never executed.
import {
  storage,
  setDisk,
  fakeDisk,
  restoreDisk,
  serveStorage,
  signStorageUrl,
  verifyStorageUrl,
  contentTypeFor,
  MemoryDisk,
  Storage,
  HttpKernel,
  type Application,
  type Disk,
  type FileMetadata,
} from "@shaferllc/keel/core";
import { localDisk } from "@shaferllc/keel/storage/local";
import { s3Disk } from "@shaferllc/keel/storage/s3";
import { r2Disk, type R2BucketLike } from "@shaferllc/keel/storage/r2";

declare const bytes: Uint8Array;
declare const data: string;
declare const svg: string;

export async function usage() {
  setDisk(new MemoryDisk());
  await storage().put("avatars/1.png", bytes);
  const got = await storage().get("avatars/1.png");
  const text = await storage().getText("notes/todo.md");
  const has = await storage().exists("avatars/1.png");
  await storage().delete("avatars/1.png");
  const files = await storage().list("avatars/");
  const url = storage().url("avatars/1.png");
  return { got, text, has, files, url };
}

export async function writing() {
  // The content type is inferred from the extension — this is stored as image/png.
  await storage().put("avatars/1.png", bytes);

  // ...or set it, along with the rest of the object's metadata.
  await storage().put("exports/report.csv", data, {
    contentType: "text/csv",
    cacheControl: "public, max-age=3600",
    visibility: "private",
    metadata: { uploadedBy: "42" },
  });

  return contentTypeFor("avatars/1.png"); // "image/png"
}

export async function inspecting() {
  const meta: FileMetadata | null = await storage().metadata("avatars/1.png");
  const size = await storage().size("avatars/1.png");

  await storage().copy("avatars/1.png", "avatars/1-backup.png");
  await storage().move("tmp/upload.png", "avatars/2.png");

  return { meta, size };
}

export async function signing() {
  // A temporary URL for a private file.
  const url = await storage().signedUrl("invoices/42.pdf", { expiresIn: 300 });

  // A URL the browser PUTs to directly — the bytes never transit the app.
  const upload = await storage().signedUploadUrl("uploads/clip.mp4", {
    expiresIn: 600,
    contentType: "video/mp4",
  });

  // Sign and verify any URL yourself.
  const signed = await signStorageUrl("/storage/invoices/42.pdf", 300);
  const valid = await verifyStorageUrl(signed);

  return { url, upload, valid };
}

export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(serveStorage()); // public files under /storage
    this.use(serveStorage({ disk: "r2", basePath: "/private", signed: true, maxAge: 60 }));
  }
}

export async function testing() {
  const disk = fakeDisk(); // swap the real disk for an in-memory one

  await storage().put("avatars/1.png", bytes);

  await disk.assertExists("avatars/1.png");
  await disk.assertMissing("avatars/2.png");
  await disk.assertContents("notes/todo.md", "buy milk");
  await disk.assertCount(1, "avatars/");

  restoreDisk();
}

export function named(local: Disk, s3: Disk) {
  setDisk(local, "local");
  setDisk(s3, "s3");
  return Promise.all([
    storage("local").put("cache/x", data),
    storage("s3").put("public/logo.svg", svg),
  ]);
}

/* ----------------------------- the shipped disks ---------------------------- */

export function local() {
  setDisk(localDisk({ root: "storage/app" }));
  setDisk(localDisk({ root: "storage/private", baseUrl: "/private" }), "private");
}

declare const accountId: string;
declare const credentials: { accessKeyId: string; secretAccessKey: string };

export function s3() {
  setDisk(
    s3Disk({
      bucket: "uploads",
      region: "us-east-1",
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    }),
  );

  // R2, MinIO, Spaces: give it the endpoint and the bucket moves into the path.
  setDisk(
    s3Disk({
      bucket: "uploads",
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      publicUrl: "https://cdn.example.com",
    }),
    "r2-s3",
  );
}

export async function s3Presigning(): Promise<[string, string]> {
  return Promise.all([
    storage().signedUrl("invoices/42.pdf", { expiresIn: 300 }),
    storage().signedUploadUrl("uploads/clip.mp4", {
      expiresIn: 600,
      contentType: "video/mp4",
    }),
  ]);
}

declare const bucket: R2BucketLike;

export function r2() {
  setDisk(r2Disk(bucket, { publicUrl: "https://cdn.example.com" }));
}

// A minimal custom disk (the shape of the local/R2 examples)
function makeDisk(): Disk {
  const store = new Map<string, Uint8Array>();
  return {
    async put(path, b) {
      store.set(path, b);
    },
    async get(path) {
      return store.get(path) ?? null;
    },
    async exists(path) {
      return store.has(path);
    },
    async delete(path) {
      store.delete(path);
    },
    async list(prefix = "") {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
    url: (path) => `https://cdn.example/${path}`,
  };
}

export function wrap(): Storage {
  return new Storage(makeDisk());
}
