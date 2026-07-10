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

## What the adapter does

It implements the Inertia protocol for you:

| Situation | Response |
|-----------|----------|
| First visit (no `X-Inertia` header) | The full HTML document from your `rootView` |
| Inertia navigation (`X-Inertia: true`) | `{ component, props, url, version }` JSON + `X-Inertia` header |
| Asset version changed (GET) | `409` + `X-Inertia-Location` so the client hard-reloads |
| Partial reload (`X-Inertia-Partial-Data`) | Only the requested props, for the matching component |

## The client

The adapter is the server half. On the client, set up Inertia as usual
(`@inertiajs/react` / `-vue` / `-svelte`) pointing at `#app`, and build your
`app.js` bundle referenced by the root view. See
[inertiajs.com](https://inertiajs.com) for the client setup.
