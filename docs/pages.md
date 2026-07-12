# Pages

Page-based routing — **a file is a route**.

```
resources/pages/index.tsx           →  /
resources/pages/about.tsx           →  /about
resources/pages/users/index.tsx     →  /users
resources/pages/users/[id].tsx      →  /users/:id
resources/pages/docs/[...slug].tsx  →  /docs/*   (catch-all)
```

```tsx
// resources/pages/users/[id].tsx
import { db, type Ctx, type PageProps } from "@shaferllc/keel/core";

export const loader = (c: Ctx) => db("users").where("id", c.req.param("id")).first();

export default function UserPage({ params, data }: PageProps<{ id: string }, User>) {
  return (
    <Layout>
      <h1>{data.name}</h1>
      <p>User #{params.id}</p>
    </Layout>
  );
}
```

That's the whole page. No route file to keep in sync, no controller, no wiring.

## It doesn't replace the router — it drives it

Every page becomes an **ordinary named route**. `url()` finds it, route middleware
applies to it, and `keel routes` lists it. You can mix pages and hand-written
routes freely, and reach for a controller the moment a page outgrows a file.

That matters, because file-based routing is a lovely default and a bad prison.
Here it's a *convenience over* the router, not a replacement for it.

## Registering them

In a service provider's `boot()`:

```ts
import { pages } from "@shaferllc/keel/core";

export class PageServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    await pages(); // scans resources/pages
  }
}
```

`pages()` reads the filesystem, so it's **Node-only**. On the edge, hand
`definePages()` a build-time manifest instead — Vite's `import.meta.glob` produces
exactly the map it wants:

```ts
definePages(import.meta.glob("./pages/**/*.tsx", { eager: true }));
```

Same behavior, no filesystem.

## The file conventions

| File | URL |
|------|-----|
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/[id].tsx` | `/users/:id` |
| `users/[id]/edit.tsx` | `/users/:id/edit` |
| `teams/[team]/users/[id].tsx` | `/teams/:team/users/:id` |
| `docs/[...slug].tsx` | `/docs/*` — a catch-all; `params.slug` is the whole rest |
| `_layout.tsx` | **not a route** — a leading `_` keeps a file private |

A trailing `index` names its directory rather than a child of it. A leading
underscore is how layouts, partials, and helpers live *beside* your pages without
becoming URLs.

## Specificity is decided for you

This is the part file-based routing usually gets wrong:

```
users/[id].tsx      →  /users/:id
users/new.tsx       →  /users/new
```

Register `:id` first and `/users/new` is **unreachable forever** — `:id` happily
matches `"new"`. Whether your app works would come down to the order the
filesystem happened to hand back.

So pages are **sorted before they're registered**: literal segments beat
parameters, parameters beat catch-alls, and a catch-all is always the last resort.
`/users/new` wins, and the file layout stops being a trap.

## Loading data

`loader` runs before the page renders; whatever it returns arrives as `data`.

```tsx
export const loader = async (c: Ctx) => {
  const post = await db("posts").where("slug", c.req.param("slug")).first();
  if (!post) throw new NotFoundException();
  return post;
};

export default function PostPage({ data }: PageProps<{ slug: string }, Post>) {
  return <article>{data.body}</article>;
}
```

It takes the request context, so it can read params, query, headers, or the
session. A page with no `loader` simply gets `data: undefined`.

## Middleware

Per page:

```tsx
export const middleware = [authGuard()];
```

Or for every page at once:

```ts
await pages({ middleware: [authGuard()] });
```

Both run before the `loader`, so a page that's refused never loads its data.

## Names and URLs

Each page gets a route name derived from its path — `users/[id].tsx` becomes
`users.id` — so URL generation works without you naming anything:

```ts
router.url("users.id", { id: 5 }); // "/users/5"
```

Override it when the derived name is ugly:

```tsx
export const name = "users.show";
```

## Escape hatches

Move a page's URL without moving the file:

```tsx
export const path = "/pricing"; // even though the file is at marketing/plans.tsx
```

Mount every page under a prefix:

```ts
await pages({ prefix: "/app" }); // index.tsx is now /app
await pages({ dir: "app/pages" }); // ...or keep them somewhere else
```

---

## API reference

### `pages(options?)`

`pages(options?: PagesOptions): Promise<RegisteredPage[]>`

Scan a directory and register every page in it. **Node only** — it reads the
filesystem (`node:fs` is imported dynamically, so the core still loads on the
edge).

### `definePages(modules, options?)`

`definePages(modules: Record<string, PageModule>, options?: PagesOptions): RegisteredPage[]`

Register pages from a `file path → module` map. The edge-safe half — pair it with
`import.meta.glob`.

### `PagesOptions`

| Option | Meaning |
|--------|---------|
| `dir` | Where the pages live. Default `"resources/pages"` |
| `prefix` | Prefix every page's URL |
| `middleware` | Middleware applied to every page |
| `router` | The router to register on. Defaults to the application's |

### `PageModule`

What a page file exports.

| Export | Meaning |
|--------|---------|
| `default` | **Required.** The component. May be async |
| `loader` | `(ctx) => data` — runs before the page renders |
| `middleware` | Middleware for this page alone |
| `name` | The route name. Defaults to one derived from the path |
| `path` | Override the URL entirely |

### `PageProps<P, D>`

What the component receives: `params` (typed by `P`), `data` (whatever `loader`
returned, typed by `D`), and `ctx`.

### `RegisteredPage`

`{ file, pattern, name }` — what `pages()` / `definePages()` return, so you can
see exactly what got mounted.

### `routePattern(file)` / `routeName(file)`

The two pure functions behind the conventions, exported so you can test or reuse
them. `routePattern("users/[id].tsx")` → `"/users/:id"`;
`routeName("users/[id].tsx")` → `"users.id"`.
