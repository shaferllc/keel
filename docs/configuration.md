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
import { env } from "@keel/core";

env("APP_NAME");                 // "Keel"
env("APP_DEBUG", false);         // true  (string "true" -> boolean)
env("APP_PORT", 3000);           // 3000  (coerced to number when the fallback is a number)
env("MISSING", "default");       // "default"
```

Use `env()` **only inside config files**, not scattered through your app. That
keeps all environment coupling in one layer.

## Config files

Each file in `config/` exports a default object and is loaded under its
filename. `config/app.ts` becomes the `app` namespace:

```ts
// config/app.ts
import { env } from "@keel/core";

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
import { config } from "@keel/core";

config("app.name");          // "Keel"
config("app.port", 3000);    // with a fallback
config("services.stripe.key"); // nested access
```

It resolves against the active application (registered automatically when the
`Application` is created), the same way Laravel's `config()` helper works. There
is a matching `app()` helper that returns the container:

```ts
import { app } from "@keel/core";

app().make(SomeService);
```

### The long form

Under the hood, `config()` is sugar for resolving the `Config` repository and
reading with dot notation. You can still do that explicitly:

```ts
import { Config } from "@keel/core";

const config = app.make(Config);

config.get("app.name");                    // "Keel"
config.get("app.port", 3000);              // with a fallback
config.get("services.stripe.key");         // nested access
config.set("app.debug", false);            // override at runtime
config.all();                              // the whole tree
```

From within the `Application` there's a shortcut:

```ts
app.config().get("app.name");
```

## How loading works

At boot, `Application`:

1. Loads `.env` via `dotenv`.
2. Reads every `*.ts` / `*.js` file in `config/`.
3. Registers each under its filename in the `Config` repository.

So `config/mail.ts` is reachable at `config('mail.*')` with zero wiring. See
[`src/core/application.ts`](../src/core/application.ts) (`loadConfig`) and
[`src/core/config.ts`](../src/core/config.ts).
