# Feature Flags

Ship the code dark, turn it on when you're ready — per user, per team, or for
everyone. A **flag** is defined once (a value, or a resolver that decides per
scope), asked anywhere with `feature()`, and overridden explicitly when support
needs to force it on for one account.

```ts
import { features, feature } from "@shaferllc/keel/core";

// a provider's boot()
features().define("new-billing", (user) => (user as User).plan === "pro");
features().define("dark-mode", true);

// anywhere
if (await feature("new-billing", user)) {
  return newBillingFlow();
}
```

## The first answer sticks

The first time a flag is resolved for a scope, the answer is **persisted**. A
user who saw the new thing keeps seeing it while you ramp up — a resolver edit
doesn't flap experiences on the next request. Changing a decision is explicit:

```ts
await features().activate("new-billing", user);    // force on, this user
await features().deactivate("new-billing", team);  // force off, this team
await features().deactivate("new-billing");        // force off, globally
await features().forget("new-billing", user);      // back to the resolver
await features().purge("new-billing");             // every stored decision, gone
```

An **undefined flag is off**, not an error — code behind a flag nobody defined
is simply dark. That means you can merge the `feature()` check before the
`define()`, and delete the definition before the last check.

## Scopes

A scope is `null` (global), a primitive (an id, an email), or an object with an
`id` — a `User`, a `Team`, any model. Objects are keyed as `ClassName:id`, so
`User#7` today matches `User#7` tomorrow. An object *without* an `id` is
refused: it has no stable identity, and silently keying every request
differently would make each check a fresh resolution.

```ts
await feature("new-billing", user);        // per user
await feature("beta-api", team);           // per team
await feature("maintenance-banner");       // global
```

## Rich values

A flag's value is JSON, not just a boolean — it can carry a variant or a limit.
`active()` is simply "truthy"; `value()` returns the payload:

```ts
features().define("search", (user) => (isBetaTester(user) ? { engine: "meili" } : false));

const search = await features().value("search", user); // { engine: "meili" } | false
await features().activate("search", user, { engine: "typesense" }); // override with a value
```

## Storage

Like the queue and the cache: in-memory by default (per process — right for dev
and tests), a database store when a rollout must be shared and survive a
deploy. Add `flagsMigration()` to your migrations and swap the store in a
provider:

```ts
import { setFeatures, DatabaseFlagStore, flagsMigration } from "@shaferllc/keel/core";

// database/migrations/0006_features.ts
export default flagsMigration();

// a provider's register()
setFeatures(new DatabaseFlagStore());
```

Any backend is four methods — implement `FlagStore` (`get` / `set` / `delete` /
`purge`, keyed by feature name and scope key) to store decisions in Redis, KV,
or a vendor's flag service.

## In tests

The default in-memory store makes flags deterministic already; give a test its
own instance to avoid cross-test bleed:

```ts
import { setFeatures, MemoryFlagStore } from "@shaferllc/keel/core";

const flags = setFeatures(new MemoryFlagStore());
flags.define("new-billing", true);
```

---

## API reference

### `feature(name, scope?)`

`feature(name: string, scope: FlagScope = null): Promise<boolean>`

Shorthand for `features().active(name, scope)` — is the flag on for this scope?

### `features()` / `setFeatures(storeOrInstance)`

`features(): Features` returns the process-wide instance.
`setFeatures(storeOrInstance: FlagStore | Features): Features` swaps the store
(or the whole instance) behind it, and returns the active `Features`.

### `Features`

| Method | Signature |
|--------|-----------|
| `define` | `(name, valueOrResolver?) => this` — a fixed value or a `(scope) => value` resolver; default `true` |
| `defined` | `() => string[]` |
| `value` | `(name, scope?) => Promise<unknown>` — stored value, else resolve + persist |
| `active` | `(name, scope?) => Promise<boolean>` — `value` is truthy |
| `inactive` | `(name, scope?) => Promise<boolean>` |
| `activate` | `(name, scope?, value?) => Promise<void>` — force on (default `true`) |
| `deactivate` | `(name, scope?) => Promise<void>` — force off |
| `forget` | `(name, scope?) => Promise<void>` — drop the stored value; the resolver decides afresh |
| `purge` | `(name?) => Promise<void>` — drop every stored value for a flag, or all of them |

### Stores

`MemoryFlagStore` (the default) and `DatabaseFlagStore({ table?, connection? })`
— rows in `features` (name, scope, JSON value), unique per `(name, scope)`.
`flagsMigration(table?)` is the schema. `FlagStore` is the seam:

```ts
interface FlagStore {
  get(feature: string, scopeKey: string): Promise<unknown> | unknown;
  set(feature: string, scopeKey: string, value: unknown): Promise<void> | void;
  delete(feature: string, scopeKey: string): Promise<void> | void;
  purge(feature?: string): Promise<void> | void;
}
```

`flagScopeKey(scope)` is the exported keying function — `"__global"` for null,
`String(primitive)`, `ClassName:id` for objects.
