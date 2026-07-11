// Type-check harness for docs/hashing.md. Every type-checkable snippet in the
// guide is exercised here against the real exports, so a renamed method or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never executed.
import { hash, encryption } from "@shaferllc/keel/core";

declare const password: string;
declare const plain: string;
declare const submitted: string;
declare const untrustedInput: string;
declare const user: { password: string; save(): Promise<void> };
declare function unauthorized(): Response;

export async function hashingPasswords() {
  const hashed = await hash.make(password); // store this
  const ok = await hash.verify(hashed, password); // → true / false
  return { hashed, ok };
}

export async function saltsDiffer() {
  const a = await hash.make("hunter2");
  const b = await hash.make("hunter2");
  const sameString = a === b; // false — different salts
  const va = await hash.verify(a, "hunter2");
  const vb = await hash.verify(b, "hunter2");
  return { sameString, va, vb };
}

export async function rotating() {
  if (await hash.verify(user.password, plain)) {
    if (hash.needsRehash(user.password)) {
      user.password = await hash.make(plain);
      await user.save();
    }
  }
}

export async function workFactor() {
  const hashed = await hash.make(password, 200_000);
  const atTarget = hash.needsRehash(hashed, 200_000); // false
  const belowNew = hash.needsRehash(hashed, 300_000); // true
  return { hashed, atTarget, belowNew };
}

export async function encryptingValues() {
  const token = await encryption.encrypt({ userId: 1, scope: "reset" });
  const data = await encryption.decrypt<{ userId: number }>(token);
  return { token, data };
}

export async function decryptGuard() {
  const value = await encryption.decrypt(untrustedInput);
  if (value === null) return unauthorized();
  return value;
}

export async function reference() {
  const hashed = await hash.make(password);
  const stronger = await hash.make(password, 200_000);

  const authed = await hash.verify(user.password, submitted);

  const needs = hash.needsRehash(user.password);
  if (needs) {
    user.password = await hash.make(plain);
  }

  const token = await encryption.encrypt({ userId: 1, scope: "reset" });
  const decoded = await encryption.decrypt<{ userId: number }>(token);

  return { hashed, stronger, authed, needs, token, decoded };
}
