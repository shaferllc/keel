# Inertia

Keel ships a server-side [Inertia.js](https://inertiajs.com) adapter. Pair Keel's
routing with an Inertia client (React, Vue, or Svelte) and render page components
from the server without building an API — `inertia("Page", props)` returns the
right response automatically.

## Configure it

Bind an `Inertia` instance in a service provider. You supply the **root view**
(the HTML shell that embeds the page data and loads your client bundle) and an
optional asset **version**:

```ts
import { ServiceProvider, singleton, Inertia, inertiaPageAttr } from "@shaferllc/keel/core";

export class InertiaServiceProvider extends ServiceProvider {
  register(): void {
    singleton(
      Inertia,
      () =>
        new Inertia({
          version: "1",
          rootView: (page) =>
            `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
            `<body><div id="app" data-page="${inertiaPageAttr(page)}"></div>` +
            `<script src="/assets/app.js"></script></body></html>`,
        }),
    );
  }
}
```

`inertiaPageAttr(page)` serializes and HTML-escapes the page object for the
`data-page` attribute.

> **The version defaults to `"1"`.** Omit it and every deploy reports the same
> asset version — fine until you ship new assets, at which point stale clients
> won't be told to hard-reload. Bump it (a build hash, a timestamp) whenever your
> bundle changes so the adapter can force a full reload on mismatch.

## Render a page

From a controller, or straight from a route:

```ts
import { inertia } from "@shaferllc/keel/core";

// controller
show() {
  return inertia("Users/Show", { user: getUser(param("id")) });
}

// brisk route
router.on("/dashboard").renderInertia("Dashboard", { title: "Welcome" });
```

`inertia()` looks up the bound `Inertia` instance and delegates to its `render`.
The component name is the client-side path Inertia resolves (e.g. `Users/Show`
maps to your `Pages/Users/Show` component); `props` is any JSON-serializable
object.

> **Configure the adapter before you render.** `inertia()` throws
> `Inertia is not configured…` if no `Inertia` instance is bound in the
> container. Register the provider (above) during boot, before any route runs.

## What the adapter does

It implements the Inertia protocol for you. Every branch below is decided from
the incoming request headers — you call `inertia("Page", props)` once and the
adapter picks the response:

| Situation | Response |
|-----------|----------|
| First visit (no `X-Inertia` header) | The full HTML document from your `rootView` (a `string`) |
| Inertia navigation (`X-Inertia: true`) | `{ component, props, url, version }` JSON + `X-Inertia: true` and `Vary: X-Inertia` headers |
| Asset version changed (GET) | `409` + `X-Inertia-Location` so the client hard-reloads |
| Partial reload (`X-Inertia-Partial-Data`) | Only the requested props, for the matching component |

The `url` embedded in the page object is the request's `pathname + search` —
Inertia uses it to keep the browser history in sync.

### Version mismatches

The version check only fires on a **GET** Inertia request whose
`X-Inertia-Version` header differs from the adapter's configured version. On a
mismatch the adapter returns an empty `409` with `X-Inertia-Location` set to the
current URL; the Inertia client sees the `409` and does a full page reload to
pull fresh assets. Non-GET requests (a form POST, say) skip the check and render
normally.

### Partial reloads

When the client asks for a partial reload it sends two headers:
`X-Inertia-Partial-Component` (the component it already has mounted) and
`X-Inertia-Partial-Data` (a comma-separated list of prop keys it wants). The
adapter only trims props when the partial component **matches** the component
you're rendering — so a partial reload of `Users/Index` won't accidentally
strip props when you render `Users/Show`. Matching props are filtered down to
the requested keys; everything else is dropped from the payload.

```ts
// Client requests only `notifications` for the already-mounted Dashboard.
// The adapter sends { component: "Dashboard", props: { notifications }, ... }.
inertia("Dashboard", { stats, notifications, activity });
```

> Partial reloads are an **allow-list** (the `only` mechanism). The adapter does
> not implement Inertia's `except` variant — every listed key is kept, all others
> are dropped.

## The client

The adapter is the server half. On the client, set up Inertia as usual
(`@inertiajs/react` / `-vue` / `-svelte`) pointing at `#app`, and build your
`app.js` bundle referenced by the root view. See
[inertiajs.com](https://inertiajs.com) for the client setup.

## Related

`inertia()` resolves the `Inertia` instance from the [container](./container.md),
so it's bound like any other [service provider](./providers.md) singleton. The
`renderInertia` brisk-route helper lives on the [router](./routing.md).

---

## API reference

### `inertia(component, props?)`

`inertia(component: string, props?: Record<string, unknown>): Response | string`

Renders an Inertia response for the current request using the `Inertia` instance
bound in the container.

```ts
import { inertia } from "@shaferllc/keel/core";

return inertia("Users/Show", { user });
```

**Notes:** `props` defaults to `{}`. Throws `Inertia is not configured…` if no
`Inertia` instance is bound — bind one in a provider first. Returns a `string`
(the `rootView` HTML) on a first load and a `Response` (JSON, or a `409`) on an
Inertia navigation, so it fits anywhere a route handler can return either.

### `inertiaPageAttr(page)`

`inertiaPageAttr(page: InertiaPage): string`

HTML-escapes a JSON-serialized page object for embedding in the `data-page`
attribute of your root element.

```ts
`<div id="app" data-page="${inertiaPageAttr(page)}"></div>`;
```

**Notes:** escapes `&`, `"`, `'`, `<`, and `>` (in that order, so `&` isn't
double-escaped). Use it only inside a double-quoted attribute in your `rootView`
— it is the escaping counterpart the Inertia client reads back off `#app`.

### `Inertia`

The adapter itself. Construct one and bind it as a container singleton; the
`inertia()` helper resolves it per request. You rarely call its methods directly
— `inertia()` and `renderInertia()` do.

#### `new Inertia(options)`

`new Inertia(options: InertiaOptions)`

Creates an adapter with a root view and an optional asset version.

```ts
new Inertia({
  version: "1",
  rootView: (page) => `<div id="app" data-page="${inertiaPageAttr(page)}"></div>`,
});
```

**Notes:** `options.version` defaults to `"1"` when omitted; `options.rootView`
is required.

#### `render(component, props?)`

`render(component: string, props?: Record<string, unknown>): Response | string`

Produces the correct response for the current request: the full HTML document on
a first visit, the page JSON on an Inertia navigation, a `409` on a version
mismatch, or a trimmed payload for a partial reload.

```ts
const html = new Inertia({ rootView }).render("Dashboard", { title: "Welcome" });
```

**Notes:** reads the active request from `ctx()`, so call it inside a request
(the `inertia()` helper does this for you). `props` defaults to `{}`. The JSON
branch sets `X-Inertia: true` and `Vary: X-Inertia`; the `409` branch sets
`X-Inertia-Location`.

### Interfaces & types

#### `InertiaOptions`

```ts
interface InertiaOptions {
  version?: string;
  rootView: (page: InertiaPage) => string;
}
```

The constructor argument. `version` is the asset version (default `"1"`); a
mismatch against the client's `X-Inertia-Version` forces a full reload.
`rootView` renders the HTML shell for a first, non-XHR load — it receives the
`InertiaPage` and must embed it (typically via `inertiaPageAttr`) so the client
can boot.

```ts
const options: InertiaOptions = {
  version: "abc123",
  rootView: (page) =>
    `<div id="app" data-page="${inertiaPageAttr(page)}"></div>`,
};
```

#### `InertiaPage`

```ts
interface InertiaPage {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string;
}
```

The Inertia page object — the payload both the JSON response and the `rootView`
receive. `component` is the page name, `props` its (possibly partial-reload
filtered) data, `url` the request's `pathname + search`, and `version` the
adapter's asset version. You consume it inside `rootView`; you don't build it
yourself.
