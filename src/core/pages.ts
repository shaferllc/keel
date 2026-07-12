/**
 * Page-based routing — a file *is* a route.
 *
 *   resources/pages/index.tsx           ->  /
 *   resources/pages/about.tsx           ->  /about
 *   resources/pages/users/index.tsx     ->  /users
 *   resources/pages/users/[id].tsx      ->  /users/:id
 *   resources/pages/docs/[...slug].tsx  ->  /docs/*   (catch-all)
 *
 * A page is a module whose default export is a component. Everything else is
 * optional: a `loader` to fetch its data, `middleware` to guard it, a `name` for
 * URL generation.
 *
 *   // resources/pages/users/[id].tsx
 *   export const middleware = [authGuard()];
 *   export const loader = async (c: Ctx) => db("users").find(c.req.param("id"));
 *
 *   export default function UserPage({ params, data }: PageProps<{ id: string }, User>) {
 *     return <h1>{data.name}</h1>;
 *   }
 *
 * Register them once, in a provider:
 *
 *   await pages();                       // Node — scans resources/pages
 *   definePages(import.meta.glob("./pages/**\/*.tsx", { eager: true }));  // edge/Vite
 *
 * This doesn't replace the router — it *drives* it. Every page becomes an
 * ordinary named route, so `url()`, route middleware, and `keel routes` all see
 * them, and you can mix pages and hand-written routes freely.
 */

import type { MiddlewareHandler } from "hono";

import { Router, type Ctx, type MiddlewareRef } from "./http/router.js";
import { View, type Renderable } from "./view.js";
import { app, make } from "./helpers.js";

/* --------------------------------- types ---------------------------------- */

/** What a page component receives. */
export interface PageProps<
  P extends Record<string, string> = Record<string, string>,
  D = unknown,
> {
  /** The route parameters — `[id].tsx` gives you `params.id`. */
  params: P;
  /** Whatever the page's `loader` returned, or `undefined` if it has none. */
  data: D;
  /** The request context, for the rare page that needs it. */
  ctx: Ctx;
}

/** The shape of a page module. Only the default export is required. */
export interface PageModule<
  P extends Record<string, string> = Record<string, string>,
  D = unknown,
> {
  /** The component. It may be async. */
  default: (props: PageProps<P, D>) => Renderable;
  /** Fetch this page's data before it renders. Its return value becomes `data`. */
  loader?: (ctx: Ctx) => D | Promise<D>;
  /** Middleware for this page alone. */
  middleware?: MiddlewareRef | MiddlewareRef[];
  /** The route name. Defaults to one derived from the file path. */
  name?: string;
  /** Override the URL entirely, ignoring the file's location. */
  path?: string;
}

/** A page, once it's been turned into a route. */
export interface RegisteredPage {
  /** The file it came from, relative to the pages directory. */
  file: string;
  /** The URL pattern it was registered at. */
  pattern: string;
  /** Its route name. */
  name: string;
}

export interface PagesOptions {
  /** Where the pages live. Default: `"resources/pages"`. */
  dir?: string;
  /** Prefix every page's URL — `"/app"` puts `index.tsx` at `/app`. */
  prefix?: string;
  /** Middleware applied to every page. */
  middleware?: MiddlewareRef[];
  /** The router to register on. Defaults to the application's. */
  router?: Router;
}

/* ------------------------------ path -> route ----------------------------- */

const PAGE_FILE = /\.(tsx|jsx|ts|js)$/;

/** A `[...slug]` segment — the catch-all. */
const CATCH_ALL = /^\[\.\.\.(.+)\]$/;
/** A `[id]` segment — a route parameter. */
const PARAM = /^\[(.+)\]$/;

/**
 * Turn a file path into a URL pattern.
 *
 *   index.tsx          ->  /
 *   about.tsx          ->  /about
 *   users/index.tsx    ->  /users
 *   users/[id].tsx     ->  /users/:id
 *   docs/[...slug].tsx ->  /docs/:slug{.+}
 */
export function routePattern(file: string): string {
  const segments = file
    .replace(PAGE_FILE, "")
    .split("/")
    .filter(Boolean);

  // A trailing `index` names its directory, not a child of it.
  if (segments[segments.length - 1] === "index") segments.pop();

  const path = segments
    .map((segment) => {
      const catchAll = CATCH_ALL.exec(segment);
      // Hono's `{.+}` makes the param greedy, so it swallows the slashes too.
      if (catchAll) return `:${catchAll[1]}{.+}`;

      const param = PARAM.exec(segment);
      if (param) return `:${param[1]}`;

      return segment;
    })
    .join("/");

  return `/${path}`.replace(/\/+$/, "") || "/";
}

/** A route name derived from the file path: `users/[id].tsx` -> `users.id`. */
export function routeName(file: string): string {
  const segments = file
    .replace(PAGE_FILE, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(CATCH_ALL, "$1").replace(PARAM, "$1"));

  return segments.join(".") || "index";
}

/**
 * How specific a pattern is: static beats dynamic beats catch-all.
 *
 * This ordering is the whole game. Register `/users/:id` before `/users/new` and
 * the literal page is unreachable — `:id` matches "new" and wins. So pages are
 * sorted before they're registered, most specific first, and the file layout
 * stops being a trap.
 */
function specificity(pattern: string): number[] {
  return pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment.includes("{.+}") ? 2 : segment.startsWith(":") ? 1 : 0));
}

/** Sort patterns so the most specific route is matched first. */
function byPrecedence(a: string, b: string): number {
  const sa = specificity(a);
  const sb = specificity(b);

  // A catch-all anywhere in the path sinks it to the bottom.
  const maxA = Math.max(0, ...sa);
  const maxB = Math.max(0, ...sb);
  if (maxA !== maxB) return maxA - maxB;

  // Then compare segment by segment: a literal beats a param at the same depth.
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const va = sa[i] ?? -1;
    const vb = sb[i] ?? -1;
    if (va !== vb) return va - vb;
  }

  // Same shape — longer paths (more segments) are more specific.
  return sb.length - sa.length;
}

/* ------------------------------- registering ------------------------------ */

function list(mw: MiddlewareRef | MiddlewareRef[] | undefined): MiddlewareRef[] {
  if (!mw) return [];
  return Array.isArray(mw) ? mw : [mw];
}

/**
 * Turn a map of `file path -> page module` into routes.
 *
 * This is the edge-safe half: it does no filesystem work, so on Workers you hand
 * it a build-time manifest —
 *
 *   definePages(import.meta.glob("./pages/**\/*.tsx", { eager: true }));
 *
 * On Node, `pages()` builds that map for you by scanning a directory.
 */
export function definePages(
  modules: Record<string, PageModule<never, never>>,
  options: PagesOptions = {},
): RegisteredPage[] {
  const router = options.router ?? app().make(Router);
  const prefix = (options.prefix ?? "").replace(/\/+$/, "");

  // Normalize the keys a glob gives us ("./pages/users/[id].tsx") down to the
  // part that matters ("users/[id].tsx"), so both halves agree on the file name.
  const dir = (options.dir ?? "resources/pages").replace(/^\.?\//, "").replace(/\/+$/, "");
  const relative = (key: string): string =>
    key
      .replace(/^\.?\//, "")
      .replace(new RegExp(`^${dir}/`), "")
      .replace(/^pages\//, "");

  const entries = Object.entries(modules).map(([key, module]) => {
    const file = relative(key);
    // A prefix plus the root page would otherwise give "/app/".
    const pattern = (prefix + (module.path ?? routePattern(file))).replace(/\/+$/, "") || "/";
    return { file, module, pattern };
  });

  // Most specific first — see `specificity()` for why this matters.
  entries.sort((a, b) => byPrecedence(a.pattern, b.pattern));

  return entries.map(({ file, module, pattern }) => {
    const name = module.name ?? routeName(file);

    const route = router.get(pattern || "/", async (c: Ctx) => {
      const data = module.loader ? await module.loader(c) : undefined;
      const html = await make(View).render(
        module.default({
          params: c.req.param() as never,
          data: data as never,
          ctx: c,
        }),
      );
      return c.html(html);
    });

    route.name(name);

    const middleware = [...(options.middleware ?? []), ...list(module.middleware)];
    if (middleware.length) route.middleware(middleware);

    return { file, pattern: pattern || "/", name };
  });
}

/**
 * Scan a directory and register every page in it (Node only — it reads the
 * filesystem). `node:fs` is imported dynamically, so the core still loads on the
 * edge; there, use `definePages()` with a build-time manifest instead.
 *
 *   await pages();                                  // resources/pages
 *   await pages({ dir: "app/pages", prefix: "/app" });
 */
export async function pages(options: PagesOptions = {}): Promise<RegisteredPage[]> {
  const { readdir } = await import("node:fs/promises");
  const { join, relative: relativePath } = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const base = options.dir ?? "resources/pages";
  const root = join(app().basePath, base);

  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      // A leading underscore marks a file as private — a layout, a partial, a
      // helper — so it can live beside the pages without becoming a URL.
      else if (PAGE_FILE.test(entry.name) && !entry.name.startsWith("_")) files.push(full);
    }
  }

  await walk(root);

  const modules: Record<string, PageModule<never, never>> = {};
  for (const file of files) {
    const key = relativePath(root, file).split(/[\\/]/).join("/");
    modules[key] = (await import(pathToFileURL(file).href)) as PageModule<never, never>;
  }

  return definePages(modules, { ...options, dir: base });
}

/** The middleware type a page may export, re-exported for convenience. */
export type PageMiddleware = MiddlewareRef | MiddlewareRef[] | MiddlewareHandler;
