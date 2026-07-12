// Type-check harness for docs/pages.md. Compile-only — never executed.
// The .tsx page snippets in the guide are illustrative JSX; the exports they use
// are exercised here against the real types.
import {
  pages,
  definePages,
  routePattern,
  routeName,
  db,
  ServiceProvider,
  authGuard,
  Router,
  make,
  type Ctx,
  type PageProps,
  type PageModule,
  type PagesOptions,
  type RegisteredPage,
} from "@shaferllc/keel/core";

interface User {
  id: number;
  name: string;
}

export class PageServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    await pages();
  }
}

export async function registering(): Promise<RegisteredPage[]> {
  const options: PagesOptions = {
    dir: "app/pages",
    prefix: "/app",
    middleware: [authGuard()],
  };

  await pages();
  await pages({ prefix: "/app" });
  await pages({ dir: "app/pages" });
  await pages({ middleware: [authGuard()] });

  return pages(options);
}

/** What `definePages` takes — the shape `import.meta.glob(..., { eager: true })` gives. */
export function edgeManifest(modules: Record<string, PageModule<never, never>>) {
  return definePages(modules, { dir: "resources/pages" });
}

/** A page module, spelled out — the same exports the .tsx files in the guide use. */
export const userPage: PageModule<{ id: string }, User> = {
  name: "users.show",
  path: "/users/:id",
  middleware: [authGuard()],

  loader: async (c: Ctx): Promise<User> => {
    const row = await db("users").where("id", c.req.param("id")).first();
    return row as unknown as User;
  },

  default: ({ params, data, ctx }: PageProps<{ id: string }, User>) => {
    void ctx;
    return `<h1>${data.name}</h1><p>User #${params.id}</p>`;
  },
};

export function conventions() {
  return {
    root: routePattern("index.tsx"), // "/"
    about: routePattern("about.tsx"), // "/about"
    users: routePattern("users/index.tsx"), // "/users"
    user: routePattern("users/[id].tsx"), // "/users/:id"
    docs: routePattern("docs/[...slug].tsx"), // "/docs/:slug{.+}"
    name: routeName("users/[id].tsx"), // "users.id"
  };
}

export function urls(): string {
  return make(Router).url("users.id", { id: 5 }); // "/users/5"
}
