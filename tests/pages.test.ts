import { test } from "node:test";
import assert from "node:assert/strict";

import { routePattern, routeName, definePages, type PageModule } from "../src/core/pages.js";
import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { testClient } from "../src/core/testing.js";

/* ------------------------------ file -> route ----------------------------- */

test("routePattern maps a file path to a URL", () => {
  assert.equal(routePattern("index.tsx"), "/");
  assert.equal(routePattern("about.tsx"), "/about");
  assert.equal(routePattern("users/index.tsx"), "/users");
  assert.equal(routePattern("users/[id].tsx"), "/users/:id");
  assert.equal(routePattern("users/[id]/edit.tsx"), "/users/:id/edit");
  assert.equal(routePattern("teams/[team]/users/[id].tsx"), "/teams/:team/users/:id");

  // A catch-all is a greedy param, so it swallows the slashes too.
  assert.equal(routePattern("docs/[...slug].tsx"), "/docs/:slug{.+}");

  // The extension doesn't matter.
  assert.equal(routePattern("about.jsx"), "/about");
  assert.equal(routePattern("about.ts"), "/about");
});

test("routeName derives a name from the file path", () => {
  assert.equal(routeName("index.tsx"), "index");
  assert.equal(routeName("about.tsx"), "about");
  assert.equal(routeName("users/index.tsx"), "users.index");
  assert.equal(routeName("users/[id].tsx"), "users.id");
  assert.equal(routeName("docs/[...slug].tsx"), "docs.slug");
});

/* ------------------------------- rendering -------------------------------- */

/** A page module whose component just prints something. */
function page(body: (props: { params: Record<string, string>; data: unknown }) => string, extra: Partial<PageModule> = {}) {
  return { default: body, ...extra } as unknown as PageModule<never, never>;
}

async function mount(modules: Record<string, PageModule<never, never>>, options = {}) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });

  const registered = definePages(modules, options);
  return { app, registered, client: testClient(new HttpKernel(app)) };
}

test("a page renders at its file's URL", async () => {
  const { client } = await mount({
    "index.tsx": page(() => "<h1>Home</h1>"),
    "about.tsx": page(() => "<h1>About</h1>"),
    "users/index.tsx": page(() => "<h1>Users</h1>"),
  });

  (await client.get("/")).assertOk().assertSee("<h1>Home</h1>");
  (await client.get("/about")).assertOk().assertSee("About");
  (await client.get("/users")).assertOk().assertSee("Users");
});

test("a page receives its route params", async () => {
  const { client } = await mount({
    "users/[id].tsx": page(({ params }) => `<h1>User ${params.id}</h1>`),
    "teams/[team]/users/[id].tsx": page(({ params }) => `<p>${params.team}/${params.id}</p>`),
  });

  (await client.get("/users/42")).assertSee("User 42");
  (await client.get("/teams/acme/users/7")).assertSee("acme/7");
});

test("a catch-all page swallows the rest of the path", async () => {
  const { client } = await mount({
    "docs/[...slug].tsx": page(({ params }) => `<p>${params.slug}</p>`),
  });

  (await client.get("/docs/getting-started")).assertSee("getting-started");
  (await client.get("/docs/guides/deep/nesting")).assertSee("guides/deep/nesting");
});

test("a loader's return value reaches the component as `data`", async () => {
  const { client } = await mount({
    "users/[id].tsx": page(({ data }) => `<h1>${(data as { name: string }).name}</h1>`, {
      loader: async (c) => ({ name: `User ${c.req.param("id")}` }),
    }),
  });

  (await client.get("/users/9")).assertOk().assertSee("User 9");
});

test("a page with no loader gets undefined data", async () => {
  const { client } = await mount({
    "index.tsx": page(({ data }) => `<p>${String(data)}</p>`),
  });

  (await client.get("/")).assertSee("undefined");
});

test("an async component is awaited", async () => {
  const { client } = await mount({
    "index.tsx": page((() => Promise.resolve("<h1>Async</h1>")) as never),
  });

  (await client.get("/")).assertOk().assertSee("Async");
});

/* ------------------------------- precedence ------------------------------- */

test("a literal page beats a dynamic one — file order does not decide it", async () => {
  // Registered in the worst possible order on purpose: if `/users/:id` went in
  // first, it would match "new" and /users/new would be unreachable forever.
  const { client } = await mount({
    "users/[id].tsx": page(({ params }) => `<p>dynamic:${params.id}</p>`),
    "users/new.tsx": page(() => "<p>literal</p>"),
  });

  (await client.get("/users/new")).assertSee("literal");
  (await client.get("/users/42")).assertSee("dynamic:42");
});

test("a catch-all is the last resort", async () => {
  const { client } = await mount({
    "docs/[...slug].tsx": page(() => "<p>catch-all</p>"),
    "docs/[id].tsx": page(() => "<p>dynamic</p>"),
    "docs/index.tsx": page(() => "<p>index</p>"),
    "docs/faq.tsx": page(() => "<p>literal</p>"),
  });

  (await client.get("/docs")).assertSee("index");
  (await client.get("/docs/faq")).assertSee("literal");
  (await client.get("/docs/anything")).assertSee("dynamic");
  (await client.get("/docs/a/b/c")).assertSee("catch-all");
});

test("deeper literal segments win over shallower dynamic ones", async () => {
  const { client } = await mount({
    "[slug].tsx": page(() => "<p>top-level dynamic</p>"),
    "about.tsx": page(() => "<p>about</p>"),
    "users/[id].tsx": page(() => "<p>user</p>"),
  });

  (await client.get("/about")).assertSee("about");
  (await client.get("/anything")).assertSee("top-level dynamic");
  (await client.get("/users/1")).assertSee("user");
});

/* --------------------------------- naming --------------------------------- */

test("pages become named routes, so url() works", async () => {
  const { app, registered } = await mount({
    "users/[id].tsx": page(() => "x"),
    "about.tsx": page(() => "x", { name: "marketing.about" }),
  });

  const router = app.make(Router);
  assert.equal(router.url("users.id", { id: 5 }), "/users/5");
  assert.equal(router.url("marketing.about"), "/about"); // an explicit name wins

  assert.deepEqual(
    registered.map((p) => p.name).sort(),
    ["marketing.about", "users.id"],
  );
});

test("a page can override its URL entirely", async () => {
  const { client, registered } = await mount({
    "legacy/thing.tsx": page(() => "<p>moved</p>", { path: "/new-home" }),
  });

  assert.equal(registered[0]!.pattern, "/new-home");
  (await client.get("/new-home")).assertOk().assertSee("moved");
  (await client.get("/legacy/thing")).assertNotFound();
});

/* -------------------------------- middleware ------------------------------ */

test("page middleware runs, and global page middleware runs for every page", async () => {
  const order: string[] = [];

  const guard = async (_c: unknown, next: () => Promise<void>) => {
    order.push("page-mw");
    await next();
  };
  const global = async (_c: unknown, next: () => Promise<void>) => {
    order.push("global-mw");
    await next();
  };

  const { client } = await mount(
    {
      "index.tsx": page(() => "<p>home</p>"),
      "admin.tsx": page(() => "<p>admin</p>", { middleware: [guard as never] }),
    },
    { middleware: [global as never] },
  );

  await client.get("/");
  assert.deepEqual(order, ["global-mw"]);

  order.length = 0;
  await client.get("/admin");
  assert.deepEqual(order, ["global-mw", "page-mw"]);
});

test("middleware can refuse the request before the page renders", async () => {
  let rendered = false;

  const deny = async (c: { text: (t: string, s: number) => Response }) => c.text("nope", 403);

  const { client } = await mount({
    "secret.tsx": page(() => {
      rendered = true;
      return "<p>secret</p>";
    }, { middleware: [deny as never] }),
  });

  const res = await client.get("/secret");
  res.assertForbidden();
  assert.equal(rendered, false, "the page must not render");
});

/* --------------------------------- prefix --------------------------------- */

test("a prefix moves every page under it", async () => {
  const { client, registered } = await mount(
    {
      "index.tsx": page(() => "<p>home</p>"),
      "users/[id].tsx": page(() => "<p>user</p>"),
    },
    { prefix: "/app" },
  );

  assert.deepEqual(
    registered.map((p) => p.pattern).sort(),
    ["/app", "/app/users/:id"],
  );

  (await client.get("/app")).assertOk().assertSee("home");
  (await client.get("/app/users/1")).assertOk().assertSee("user");
  (await client.get("/")).assertNotFound();
});

/* ------------------------------- glob keys -------------------------------- */

test("glob-style keys are normalized down to the file path", async () => {
  // This is what import.meta.glob hands you on the edge.
  const { client, registered } = await mount(
    {
      "./resources/pages/index.tsx": page(() => "<p>home</p>"),
      "./resources/pages/users/[id].tsx": page(() => "<p>user</p>"),
    },
    { dir: "resources/pages" },
  );

  assert.deepEqual(
    registered.map((p) => p.pattern).sort(),
    ["/", "/users/:id"],
  );
  (await client.get("/")).assertSee("home");
  (await client.get("/users/3")).assertSee("user");
});
