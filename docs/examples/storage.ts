// Type-check harness for docs/storage.md. Compile-only — never executed.
import { storage, setDisk, MemoryDisk, Storage, type Disk } from "@shaferllc/keel/core";

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

export function named(local: Disk, r2: Disk) {
  setDisk(local, "local");
  setDisk(r2, "r2");
  return Promise.all([storage("local").put("cache/x", data), storage("r2").put("public/logo.svg", svg)]);
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
