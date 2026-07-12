# Watch

Keel Watch is a debug dashboard — a Telescope for Keel. It records the requests,
queries, exceptions, logs, jobs, mail, notifications, cache lookups, events, and
scheduled tasks flowing through your app, and shows them in a single-page UI at
`/watch`, with every request linked to the queries and logs it produced.

It ships as a Keel [package](./packages.md) and is its reference implementation:
one `register()` turns it on, and its watchers observe the framework's
instrumentation event stream — they patch nothing, so installing Watch changes no
behaviour, only visibility.

## Install

```ts
// bootstrap/providers.ts
import { WatchServiceProvider } from "@shaferllc/keel/watch";

export const providers = [AppServiceProvider, WatchServiceProvider];
```

Publish the config and create the table:

```bash
keel vendor:publish --tag watch-config   # writes config/watch.ts
keel migrate                             # creates watch_entries
```

Then open `http://localhost:3000/watch`.

> Watch exposes requests, payloads, and stack traces. It is gated shut in
> production by default (see [Access](#access)) — keep it that way, or lock it
> down with your own check.

## What it records

A tab per type, each behind an on/off switch:

| Watcher | Records |
|---------|---------|
| Requests | method, path, status, duration, headers (auth/cookies redacted) |
| Queries | SQL, bindings, duration, connection; slow queries are tagged |
| Exceptions | class, message, stack, the request that threw |
| Logs | every log line, at any level |
| Mail | sent messages (subject, recipients, body) |
| Jobs | queued jobs as they complete or fail |
| Notifications | deliveries and their channels |
| Cache | hits and misses *(off by default — noisy)* |
| Events | app events *(off by default — noisy)* |
| Schedule | scheduled tasks as they run |

Clicking any entry shows its full detail and **everything else in its batch** —
the request it belonged to and every query, log, and exception that request
produced.

## Configuration

`config/watch.ts` (publish it, then edit):

```ts
export default {
  enabled: env("WATCH_ENABLED", true),
  path: "watch",                 // the dashboard mounts at /watch
  storage: "database",           // "database" persists; "memory" is a per-process ring
  connection: undefined,         // which DB connection (default when omitted)
  table: "watch_entries",
  limit: 100,                    // API page size; the memory ring is 10× this
  sampling: 1,                   // record this fraction of entries (0–1)
  slowQueryMs: 100,              // queries at/above this are tagged "slow"
  ignorePaths: [],               // request paths to skip
  retentionHours: 24,            // keel watch:prune deletes entries older than this
  watchers: { cache: false, event: false /* … the rest default on */ },
};
```

### Storage

- **`database`** (default) — a `watch_entries` table via any registered
  connection. Survives restarts, shared across processes; needs `keel migrate`.
- **`memory`** — a per-process ring buffer. Zero setup, great for a single dev
  process or the edge; entries vanish on restart and aren't shared.

## Access

By default the dashboard is open only when `app.debug` is on or the app isn't in
production. Anywhere else, lock it to your own check:

```ts
import { Watch } from "@shaferllc/keel/watch";
import { auth } from "@shaferllc/keel/core";

Watch.auth(() => auth().check() && Boolean(auth().user()?.isAdmin));
```

The gate guards the JSON API too, so entries can't be read by anyone the
dashboard wouldn't show them to.

## Pruning

With database storage, keep the table small:

```bash
keel watch:prune            # delete entries older than retentionHours
keel watch:prune --hours=6
```

Schedule it (see [Scheduling](./scheduling.md)) to run it automatically.

## How it works

Watch never wraps or monkey-patches the framework. The core emits a typed
[instrumentation event stream](./packages.md#observing-the-framework) —
`db.query`, `request.handled`, `exception`, `job.*`, and so on — and each watcher
is just a listener that turns an event into a stored entry, stamped with the
current request id so related entries group into one batch. Recording is
fire-and-forget: it never blocks or breaks the request it's watching, and the
store's own queries are filtered out so it never records itself.
```
