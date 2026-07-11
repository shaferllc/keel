// Type-check harness for docs/debugging.md. Every type-checkable snippet in the
// reference is exercised here against the real exports, so a renamed function or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import { dump, dd } from "@shaferllc/keel/core";

declare const user: { id: number; name: string };
declare const order: { total: number };
declare const request: {
  all(): Promise<Record<string, unknown>>;
  headers(): Record<string, string>;
};
declare function computeTotal(): number;
declare function save(): Promise<{ id: number }>;

export function dumpBasics() {
  dump(user, order); // logs both, returns `user`

  const total = dump(computeTotal()); // logs the total AND uses it
  return total;
}

export async function dumpInline() {
  return dump(await save()); // inspect the saved value, still return it
}

export function dumpReference() {
  const first = dump(user, order, request); // returns `user`
  first.name; // typed as the first argument's type
  return first;
}

export async function ddBasics() {
  dd(await request.all(), request.headers());
  // unreachable — dd() throws
}

export async function ddReference() {
  // `dd` returns `never`, so TS treats everything after it as unreachable.
  const value = await request.all();
  dd(value);
}
