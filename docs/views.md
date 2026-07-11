# Views

Keel renders HTML with **Hono JSX** — type-safe components that run identically
on Node and on Cloudflare Workers (no filesystem templating, so it ports
anywhere). Views live by convention in `resources/views/`.

## A view is a component

```tsx
// resources/views/welcome.tsx
// @jsxRuntime automatic
// @jsxImportSource hono/jsx
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

export const WelcomePage: FC<{ appName: string }> = ({ appName }) => (
  <Layout title={appName}>
    <h1>⚓ {appName}</h1>
    <p>Your view is rendering.</p>
  </Layout>
);
```

> **The two pragma comments at the top are required** on every `.tsx` file. They
> tell the compiler (tsx / esbuild / wrangler) to use Hono's JSX runtime instead
> of React. Without them you'll get `ReferenceError: React is not defined`.

## Layouts are just components

Composition is the layout system — a `Layout` component wraps its `children`:

```tsx
// resources/views/layout.tsx
// @jsxRuntime automatic
// @jsxImportSource hono/jsx
import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<PropsWithChildren<{ title: string }>> = ({
  title,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>{title}</title>
    </head>
    <body>{children}</body>
  </html>
);
```

## Rendering a view

The quickest way is the global `view()` helper — pass the component and its
props in one call. Props are type-checked against the component, and the result
is a complete HTML document (doctype included) you can return straight from a
route handler:

```ts
import { config, view } from "@shaferllc/keel/core";
import type { Ctx } from "@shaferllc/keel/core";
import { WelcomePage } from "../../resources/views/welcome.js";

export class HomeController {
  welcome(c: Ctx) {
    return view(WelcomePage, { appName: config("app.name", "Keel") });
  }
}
```

For a component with no props, just pass the component: `view(HomePage)`.

Note the view file is imported with a `.js` extension (TypeScript convention)
even though the source is `.tsx`.

### The long form

`view()` is sugar over the `View` service. You can resolve it yourself:

```ts
import { View } from "@shaferllc/keel/core";
// inside a controller with the container as `this.app`:
return this.app.make(View).render(WelcomePage({ appName: "Keel" }));
```

## The View service

`View` is bound as a singleton in the container.

| Method | Purpose |
|--------|---------|
| `render(content)` | Render a component / string / promise to a full HTML document (async) |

`render()` accepts a JSX node, a raw string, a promise of either, or `null`
(which renders just the doctype). Configure it by binding your own instance:

```ts
this.app.singleton(View, () => new View({ doctype: false }));
```

## Passing data

Props are the data channel — plain typed function arguments:

```ts
this.app.make(View).render(UserProfile({ user, posts }));
```

No magic globals, no separate "view data" bag: if a component needs something,
it's a prop.

## Why JSX (and not a file-based template engine)?

File-based template engines need to read templates from disk at runtime, which
doesn't work on edge runtimes like Cloudflare Workers. JSX components compile to
plain functions, so the exact same view code runs on your Node dev server and on
a Worker in production. That portability is what lets Keel's own website be a
Keel app deployed to Cloudflare.
