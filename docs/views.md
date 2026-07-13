# Views

Keel renders HTML with **Hono JSX** — type-safe components that run identically
on Node and on Cloudflare Workers (no filesystem templating, so it ports
anywhere). Views live by convention in `resources/views/`.

For a ready-made look — tokens, buttons, fields, panels — see [UI](./ui.md)
(`@shaferllc/keel/ui`). Starters already import it.

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

## Async views

`render()` awaits its content, so a component may be `async` (or use Hono's
`<Suspense>`) — do data-fetching inside the component and return the resolved
tree. Both the sync and async cases go through the same call:

```tsx
// resources/views/dashboard.tsx
// @jsxRuntime automatic
// @jsxImportSource hono/jsx
import type { FC } from "hono/jsx";

export const Dashboard: FC<{ userId: number }> = async ({ userId }) => {
  const stats = await loadStats(userId);
  return <pre>{JSON.stringify(stats)}</pre>;
};
```

The helper renders it the same way: `return view(Dashboard, { userId })`. The
returned `Promise<string>` doesn't resolve until the component's own promises do.

## The doctype

By default `render()` prepends `<!DOCTYPE html>\n` — the output is a complete
document ready to serve. Two things to know:

- Passing `null`/`undefined` renders **just** the doctype (an empty document
  shell), not an empty string.
- For fragments — an HTMX swap, an email partial, anything that isn't a
  standalone page — bind a `View` with the doctype off:

```ts
this.app.singleton(View, () => new View({ doctype: false }));
```

Now `render()` returns exactly the component's HTML, no prefix.

## Why JSX (and not a file-based template engine)?

File-based template engines need to read templates from disk at runtime, which
doesn't work on edge runtimes like Cloudflare Workers. JSX components compile to
plain functions, so the exact same view code runs on your Node dev server and on
a Worker in production. That portability is what lets Keel's own website be a
Keel app deployed to Cloudflare.

## Related

Views are what a [controller](./controllers.md) returns; wire them to URLs in
[routing](./routing.md). For sending HTML by email rather than over HTTP, the
same components feed [mail](./mail.md).

---

## API reference

### `view(component, props?)`

`view<P>(component: (props: P, ...rest: any[]) => Renderable, props: P): Promise<string>`
`view(component: (...rest: any[]) => Renderable): Promise<string>`

Renders a component through the container's `View` service in one call, returning
a complete HTML document. The props overload type-checks `props` against the
component's own prop type.

```ts
import { view } from "@shaferllc/keel/core";

return view(WelcomePage, { appName: "Keel" }); // component with props
return view(HomePage);                          // component with no props
```

**Notes:** resolves the singleton `View` from the active application, so it
throws `No Keel application has been bootstrapped…` if called before an
`Application` exists. It calls the component as `component(props)` and renders the
result — meaning it invokes the function directly rather than through JSX, so
pass the component itself, not `<WelcomePage />`. Returns a `Promise<string>`;
return it straight from a route handler.

### `View`

The rendering service. Bound as a singleton in the container, so you normally
reach it via the `view()` helper or `app.make(View)`. Construct one yourself only
to change its config (e.g. disabling the doctype).

#### `new View(config?)`

`new View(config?: ViewConfig): View`

Creates a view renderer. With no argument the doctype is on.

```ts
import { View } from "@shaferllc/keel/core";

const fragments = new View({ doctype: false });
```

**Notes:** rebind the singleton to install a custom instance app-wide:
`app.singleton(View, () => new View({ doctype: false }))`.

#### `render(content)`

`render(content: Renderable): Promise<string>`

Renders a component, string, or promise to an HTML string, awaiting any async
tree first.

```ts
await new View().render(WelcomePage({ appName: "Keel" }));
await new View().render("<p>plain html</p>");
await new View({ doctype: false }).render(Fragment({}));
```

**Notes:** `await`s `content`, then `String()`s the result — so an async
component or a `Promise<string>` resolves before rendering, and a JSX node
collapses to its HTML. `null`/`undefined` renders just the doctype (or the empty
string when `doctype: false`). Pass the *called* component (`WelcomePage(props)`),
not JSX (`<WelcomePage />`), when invoking `render` directly.

### Interfaces & types

#### `Renderable`

```ts
type Renderable =
  | string
  | Promise<string>
  | { toString(): string | Promise<string> }
  | null
  | undefined;
```

Anything `render()` accepts. Covers a raw HTML string, a promise of one, any
object with a `toString()` (which is what a Hono JSX node is), or nullish (renders
empty). It matches the return type of a Hono function component, so components
drop straight in.

```ts
const a: Renderable = "<h1>hi</h1>";
const b: Renderable = Promise.resolve("<h1>hi</h1>");
const c: Renderable = null;
```

#### `ViewConfig`

```ts
interface ViewConfig {
  doctype?: boolean; // default true
}
```

The options bag for `new View(...)`. Set `doctype: false` to stop prepending
`<!DOCTYPE html>` — use it for fragments and partials.

```ts
const config: ViewConfig = { doctype: false };
```
