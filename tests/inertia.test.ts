import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { Inertia, inertiaPageAttr } from "../src/core/inertia.js";
import { singleton } from "../src/core/helpers.js";

async function build(
  configure: (r: Router) => void,
  opts: { version?: string; withInertia?: boolean } = {},
) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  if (opts.withInertia !== false) {
    singleton(
      Inertia,
      () =>
        new Inertia({
          version: opts.version ?? "1",
          rootView: (page) =>
            `<!DOCTYPE html><div id="app" data-page="${inertiaPageAttr(page)}"></div>`,
        }),
    );
  }
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("inertia: first load returns the HTML shell with embedded page", async () => {
  const hono = await build((r) => r.on("/home").renderInertia("Home", { msg: "hi" }));
  const res = await hono.request("/home");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /data-page=/);
  assert.match(html, /&quot;component&quot;:&quot;Home&quot;/);
});

test("inertia: XHR request returns the JSON page object", async () => {
  const hono = await build((r) => r.on("/home").renderInertia("Home", { msg: "hi" }));
  const res = await hono.request("/home", {
    headers: { "X-Inertia": "true", "X-Inertia-Version": "1" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Inertia"), "true");
  assert.deepEqual(await res.json(), {
    component: "Home",
    props: { msg: "hi" },
    url: "/home",
    version: "1",
  });
});

test("inertia: asset-version mismatch forces a full reload (409)", async () => {
  const hono = await build((r) => r.on("/home").renderInertia("Home"), { version: "2" });
  const res = await hono.request("/home", {
    headers: { "X-Inertia": "true", "X-Inertia-Version": "1" },
  });
  assert.equal(res.status, 409);
  assert.equal(res.headers.get("X-Inertia-Location"), "/home");
});

test("inertia: partial reloads send only the requested props", async () => {
  const hono = await build((r) =>
    r.on("/home").renderInertia("Home", { a: 1, b: 2, c: 3 }),
  );
  const res = await hono.request("/home", {
    headers: {
      "X-Inertia": "true",
      "X-Inertia-Version": "1",
      "X-Inertia-Partial-Component": "Home",
      "X-Inertia-Partial-Data": "a,c",
    },
  });
  const page = (await res.json()) as { props: Record<string, unknown> };
  assert.deepEqual(page.props, { a: 1, c: 3 });
});

test("inertia: helper throws a helpful error when unconfigured", async () => {
  const hono = await build((r) => r.on("/x").renderInertia("X"), { withInertia: false });
  const res = await hono.request("/x");
  assert.equal(res.status, 500); // thrown error rendered by the kernel
});
