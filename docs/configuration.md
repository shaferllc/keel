# Configuration

Keel loads configuration from two sources: environment variables (`.env`) and
config files (`config/*.ts`). Config files read env vars; your app reads config.

## Environment variables

`.env` holds environment-specific values and secrets. It ships with:

```
APP_NAME=Keel
APP_ENV=local
APP_DEBUG=true
APP_URL=http://localhost:3000
APP_PORT=3000
```

`.env` is git-ignored. Commit a `.env.example` with safe defaults so teammates
know what to set.

### The `env()` helper

Read env vars with `env()`, which coerces obvious types:

```ts
import { env } from "@shaferllc/keel/core";

env("APP_NAME");                 // "Keel"
env("APP_DEBUG", false);         // true  (string "true" -> boolean)
env("APP_PORT", 3000);           // 3000  (coerced to number when the fallback is a number)
env("MISSING", "default");       // "default"
```

Coercion follows two rules, and they don't behave the same way:

- **Booleans are always coerced.** The literal strings `"true"` and `"false"`
  become `true` / `false` regardless of the fallback — even with no fallback at
  all. So `env("APP_DEBUG")` on `APP_DEBUG=true` returns the boolean `true`, not
  the string `"true"`.
- **Numbers are coerced only when the fallback is a number.** `env("APP_PORT", 3000)`
  returns the number `3000`, but `env("APP_PORT")` returns the *string* `"3000"` —
  without a numeric fallback there's nothing to signal that a number was wanted.
  An empty string is never treated as a number.

```ts
env("APP_PORT");        // "3000"  (string — no numeric fallback)
env("APP_PORT", 0);     // 3000    (number — fallback is numeric)
env("APP_DEBUG");       // true    (boolean, even with no fallback)
```

The generic defaults to `string`, but the return is asserted to `T` at the
boundary — the runtime value can be a boolean or number even where the type says
string. Pass a fallback of the type you expect and the type follows it.

Use `env()` **only inside config files**, not scattered through your app. That
keeps all environment coupling in one layer.

## Validating the environment

`env("DATABASE_URL")` hands back whatever is — or isn't — in `process.env`. A
missing variable is `undefined`, the app boots looking perfectly healthy, and then
dies on the first request that actually needs it. In production. At night.

`defineEnv()` checks the whole environment **at boot** and refuses to start
otherwise:

```ts
// config/env.ts
import { defineEnv, envVar } from "@shaferllc/keel/core";

export const env = defineEnv({
  APP_KEY: envVar.string({ required: true, description: "32+ random characters" }),
  PORT: envVar.number({ default: 3000 }),
  NODE_ENV: envVar.enum(["development", "test", "production"], { default: "development" }),
  DATABASE_URL: envVar.url({ required: true }),
  SENTRY_DSN: envVar.string(), // optional
});
```

```ts
env.PORT; // number — not "3000"
env.NODE_ENV; // "development" | "test" | "production" — not string
env.SENTRY_DSN; // string | undefined
```

The types are **inferred from the rules**. A `number` rule gives you a `number`; an
`enum` gives you the union, not `string`; anything optional without a default is
`| undefined`, so you can't forget to handle it.

### It reports every problem at once

```
The environment is not valid:

  • APP_KEY is required but not set (32+ random characters).
  • PORT must be a number, got "eighty".
  • NODE_ENV must be one of development, test, production, got "staging".
  • DATABASE_URL must be a valid URL, got "not a url".

Set these in your .env (or your host's environment) and start again.
```

Not the first problem — **all** of them. Fixing a deploy one missing variable per
restart is its own small hell.

### Rules

| Rule | Value | Notes |
|------|-------|-------|
| `envVar.string()` | `string` | |
| `envVar.number()` | `number` | rejects `"eighty"` |
| `envVar.boolean()` | `boolean` | accepts `true/false/1/0/yes/no/on/off` |
| `envVar.enum([...])` | the union | typed as the literal union |
| `envVar.url()` | `string` | must parse as a URL — catches a truncated connection string |

Each takes `required`, `default`, `description` (shown in the error, so they know
what to set), and `validate` for anything else:

```ts
APP_KEY: envVar.string({
  required: true,
  validate: (value) => (value.length >= 32 ? true : "must be at least 32 characters"),
});
```

**An empty string counts as absent.** `PORT=` in a `.env` file is a typo, not a
deliberate empty port.

The returned object is frozen, so nothing can quietly reassign your config at
runtime.

## Config files

Each file in `config/` exports a default object and is loaded under its
filename. `config/app.ts` becomes the `app` namespace:

```ts
// config/app.ts
import { env } from "@shaferllc/keel/core";

export default {
  name: env("APP_NAME", "Keel"),
  env: env("APP_ENV", "local"),
  debug: env("APP_DEBUG", true),
  url: env("APP_URL", "http://localhost:3000"),
  port: env("APP_PORT", 3000),
};
```

Add more files freely — `config/services.ts`, `config/mail.ts` — and they're
auto-loaded at boot. No registration needed.

## Reading config

The quickest way is the global `config()` helper — no container needed:

```ts
import { config } from "@shaferllc/keel/core";

config("app.name");          // "Keel"
config("app.port", 3000);    // with a fallback
config("services.stripe.key"); // nested access
```

It resolves against the active application (registered automatically when the
`Application` is created). There is a matching `app()` helper that returns the
container:

```ts
import { app } from "@shaferllc/keel/core";

app().make(SomeService);
```

Both `config()` and `app()` throw if no application has been bootstrapped yet —
`config()` reaches the repository *through* `app()`, so the error is the same
`No Keel application has been bootstrapped…`. In a normal single-app process the
`Application` constructor registers itself, so this only bites in tests or
scripts that skip the bootstrap.

### The long form

Under the hood, `config()` is sugar for resolving the `Config` repository and
reading with dot notation. You can still do that explicitly:

```ts
import { Config, app } from "@shaferllc/keel/core";

const config = app().make(Config);

config.get("app.name");                    // "Keel"
config.get("app.port", 3000);              // with a fallback
config.get("services.stripe.key");         // nested access
config.set("app.debug", false);            // override at runtime
config.all();                              // the whole tree
```

Note `app()` is a function — call it, then reach into the container
(`app().make(...)`), not `app.make(...)`.

From within the `Application` there's a shortcut:

```ts
app().config().get("app.name");
```

There is **no `has()` method** on `Config`. To check for a key, read it with a
sentinel fallback and compare, or pass the fallback you'd want anyway:

```ts
const config = app().make(Config);
if (config.get("services.stripe.key") !== undefined) {
  // configured
}
```

### Missing keys and fallbacks

`get()` walks the key segment by segment. If any segment is missing — or a
segment isn't an object it can descend into — it returns the fallback (or
`undefined` when you gave none) rather than throwing:

```ts
config("services.stripe.key", "");   // "" when unset — never throws
config("nope.at.all");               // undefined
```

`set()` creates intermediate objects as it goes, so you can write a deep key
into an empty tree; and `all()` returns the repository's live object by
reference — mutating it mutates the config. Treat `all()` as read-only.

## How loading works

At boot, `Application`:

1. Loads `.env` via `dotenv`.
2. Reads every `*.ts` / `*.js` file in `config/`.
3. Registers each under its filename in the `Config` repository.

So `config/mail.ts` is reachable at `config('mail.*')` with zero wiring. On
Workers (no filesystem) skip discovery and pass a config object inline —
`boot(providers, { discoverConfig: false, config })` — and it's merged under its
top-level keys the same way. See
[`src/core/application.ts`](../src/core/application.ts) (`loadConfig`) and
[`src/core/config.ts`](../src/core/config.ts).

---

## API reference

### `env(key, fallback?)`

`env<T = string>(key: string, fallback?: T): T`

Reads `process.env[key]`, coercing `"true"`/`"false"` to booleans and numeric
strings to numbers, with a typed fallback when the variable is unset.

```ts
const debug = env("APP_DEBUG", false); // boolean
const port = env("APP_PORT", 3000);    // number
const name = env("APP_NAME", "Keel");  // string
```

**Notes:** returns the fallback (or `undefined`) when the var is not set.
Boolean coercion always happens; number coercion happens **only when `fallback`
is a number** and the raw value is non-empty and numeric. Otherwise the raw
string is returned. The result is asserted to `T`, so at runtime the value may
not match the declared type unless your fallback matches the intended type.

### `config(key, fallback?)`

`config<T = unknown>(key: string, fallback?: T): T`

Global helper: resolves the `Config` repository from the active application and
reads `key` with dot notation.

```ts
config("app.name");            // unknown -> narrow or cast
config<number>("app.port", 3000);
config("services.stripe.key", "");
```

**Notes:** thin sugar for `app().make(Config).get(key, fallback)`. Throws
`No Keel application has been bootstrapped…` if there is no active application.
Returns the fallback (or `undefined`) for any missing key; never throws on a
missing key.

### `app()`

`app(): Application`

Returns the active application container — the one registered by the most recent
`Application` constructor.

```ts
app().make(Config);
app().config().get("app.name");
```

**Notes:** throws `No Keel application has been bootstrapped…` when no
`Application` has been created. `app` is a function; call it before reaching into
the container. In a single-app process the current application is set
automatically at construction, so you rarely register it by hand.

### `Config`

The dot-notation config repository. You normally resolve it from the container
(`app().make(Config)`) rather than constructing it, but the constructor is public
for tests and standalone use.

#### `new Config(items?)`

`new Config(items?: ConfigData)`

Creates a repository over the given data (default `{}`).

```ts
const repo = new Config({ app: { name: "Keel", port: 3000 } });
repo.get("app.port"); // 3000
```

**Notes:** the object is held by reference, not cloned — later `set()` calls and
`all()` operate on the same object you passed in.

#### `get(key, fallback?)`

`get<T = unknown>(key: string, fallback?: T): T`

Reads a value by dot-notation key, descending one segment at a time.

```ts
repo.get("app.name");             // value
repo.get("app.port", 3000);       // fallback if unset
repo.get<string>("services.key"); // typed read
```

**Notes:** returns `fallback` (or `undefined`) if any segment is missing or a
segment isn't an object it can descend into. Never throws for a missing key. The
value is asserted to `T` — no runtime validation.

#### `set(key, value)`

`set(key: string, value: unknown): void`

Writes a value at a dot-notation key, creating intermediate objects as needed.

```ts
repo.set("app.debug", false);
repo.set("services.stripe.key", "sk_test_…"); // creates `services` on the way
```

**Notes:** mutates the repository in place. If an intermediate segment exists but
isn't an object (or is `null`), it's overwritten with a fresh object.

#### `all()`

`all(): ConfigData`

Returns the entire config tree.

```ts
const tree = repo.all();
```

**Notes:** returns the live internal object **by reference**, not a copy —
mutating the result mutates the repository. Treat it as read-only.

> There is no `has()` method. Check presence with `get(key) !== undefined`, or
> pass the fallback you want when the key is absent.

### Interfaces & types

#### `ConfigData`

`type ConfigData = Record<string, unknown>`

The shape of the config tree: a plain string-keyed object, nested arbitrarily.
Use it to type a config object you build and merge in yourself (for example, the
inline config passed to `boot({ discoverConfig: false, config })` on Workers).

```ts
const data: ConfigData = {
  app: { name: "Keel", port: 3000 },
};
```
