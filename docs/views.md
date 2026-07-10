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

Resolve the `View` service and call `render()`. It returns a complete HTML
document (doctype included). Because a route handler that returns a string is
sent as HTML, you can return the result directly:

```ts
import { View, Application } from "@keel/core";
import type { Ctx, Container } from "@keel/core";
import { WelcomePage } from "../../resources/views/welcome.js";

export class HomeController {
  constructor(private app: Container) {}

  welcome(c: Ctx) {
    const appName = this.app.make(Application).config().get("app.name", "Keel");
    return this.app.make(View).render(WelcomePage({ appName }));
  }
}
```

Note the view file is imported with a `.js` extension (TypeScript convention)
even though the source is `.tsx`.

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
