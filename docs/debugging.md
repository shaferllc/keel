# Debugging

Two helpers for the moments you'd otherwise reach for `console.log`. Both are
edge-safe — `dump()` is a plain `console.log`, and `dd()` throws a
self-rendering exception, so neither needs any runtime-specific support.

## dump

`dump(...values)` prints to the console and **returns its first argument**, so
you can drop it inline without restructuring code:

```ts
import { dump } from "@shaferllc/keel/core";

dump(user, order);                 // logs both, execution continues

const total = dump(computeTotal()); // logs the total AND uses it
```

Every log is prefixed with `⚓ dump →` so your probes are easy to spot (and
easy to grep out later). Because it returns the first value unchanged, you can
wrap it around any expression — an argument, a return value, a link in a chain —
without changing what the code does:

```ts
return dump(await user.save());     // inspect the saved model, still return it
```

`dump()` hands your values straight to `console.log`, so the runtime's own
formatter renders them — objects stay inspectable, not flattened to a string.
(The safe JSON rendering below is `dd()`'s job, not `dump()`'s.)

> `dump()` requires at least one argument — its signature is
> `(...values: [T, ...unknown[]])`. Calling `dump()` with no arguments is a type
> error, which stops you from leaving a probe that prints nothing.

## dd — dump and die

`dd(...values)` dumps to the **browser** and halts the request — a readable HTML
page with each value pretty-printed. Perfect for inspecting state mid-request:

```ts
import { dd } from "@shaferllc/keel/core";

store() {
  dd(await request.all(), request.headers());
  // never reached
}
```

Its return type is `never`: `dd()` throws, so nothing after it runs and
TypeScript knows the following code is unreachable. Each value is serialized
with a **safe** JSON stringifier before it hits the page, so the usual
`JSON.stringify` hazards don't crash the dump:

- **circular references** render as `[Circular]` instead of throwing;
- **functions** render as `[Function: name]` (or `[Function: anonymous]`);
- **bigints** render as `123n` instead of throwing;
- **`undefined`** renders as `[undefined]` instead of vanishing.

Values are HTML-escaped before rendering, so dumping a string full of `<`, `>`,
or `&` shows the literal text rather than injecting markup.

Under the hood `dd()` throws a self-rendering exception (see
[Errors](./errors.md)), so it works the same on Node and the edge — no special
runtime support needed. The exception carries a **200** status, so the dump page
returns `200 OK`, not an error status — this is a deliberate inspection tool,
not an error path.

> **Shared references, not just cycles.** The safe stringifier tracks every
> object it has seen and never forgets one, so the *same* object appearing twice
> in unrelated places (siblings, not an actual cycle) renders as `[Circular]` on
> its second appearance. If a dump shows an unexpected `[Circular]`, that's why —
> the value isn't necessarily cyclic, just repeated.

## Turning on framework debug output

Set `APP_DEBUG=true` (i.e. `config('app.debug')`) to get full error pages with
stack traces from the kernel. Turn it off in production so internals stay hidden.
See [Errors](./errors.md) for how responses change between debug and production.

---

## API reference

Both functions are top-level exports — there are no classes to construct or
interfaces to implement. The `DumpException` that `dd()` throws is internal; you
never reference it directly.

### `dump(...values)`

`dump<T>(...values: [T, ...unknown[]]): T`

Logs all values to the console (prefixed `⚓ dump →`) and returns the first one,
so it can be dropped inline.

```ts
import { dump } from "@shaferllc/keel/core";

const total = dump(computeTotal()); // logs, then flows the value onward
dump(user, order, request);         // logs all three, returns `user`
```

**Notes:** requires at least one argument (the tuple type `[T, ...unknown[]]`
enforces it). Returns `values[0]` unchanged — never a copy — so it's safe to wrap
around any expression. Uses `console.log` directly, so formatting is the
runtime's, not the safe stringifier; it does not halt execution.

### `dd(...values)`

`dd(...values: unknown[]): never`

Dumps every value to a self-rendering HTML page and halts the request — "dump
and die".

```ts
import { dd } from "@shaferllc/keel/core";

dd(await request.all(), request.headers());
// unreachable — dd() throws
```

**Notes:** returns `never` — it throws an internal `DumpException` (a
self-handling `HttpException`) rather than returning, so any code after it is
unreachable. The rendered page returns status **200**, not an error code. Values
are serialized with the safe stringifier (circular refs → `[Circular]`,
functions → `[Function: …]`, bigints → `123n`, `undefined` → `[undefined]`) and
HTML-escaped before rendering. Accepts zero or more arguments; `dd()` with no
arguments still halts the request and renders an empty page.
