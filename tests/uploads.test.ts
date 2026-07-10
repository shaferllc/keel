import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json, ctx, request, response } from "../src/core/request.js";

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("file uploads via multipart (file/files/allFiles + fields)", async () => {
  const hono = await build((r) => {
    r.post("/upload", async () => {
      const file = await request.file("avatar");
      const docs = await request.files("docs");
      const all = await request.allFiles();
      const fields = await request.all();
      return json({
        name: file?.name,
        size: file?.size,
        docCount: docs.length,
        allKeys: Object.keys(all).sort(),
        title: fields.title,
      });
    });
  });

  const fd = new FormData();
  fd.set("title", "hello");
  fd.set("avatar", new File(["abc"], "a.png", { type: "image/png" }));
  fd.append("docs", new File(["1"], "1.txt"));
  fd.append("docs", new File(["2"], "2.txt"));

  const res = await hono.request("/upload", { method: "POST", body: fd });
  assert.deepEqual(await res.json(), {
    name: "a.png",
    size: 3,
    docCount: 2,
    allKeys: ["avatar", "docs"],
    title: "hello",
  });
});

test("content negotiation: accepts/types/language", async () => {
  const hono = await build((r) => {
    r.get("/n", () =>
      json({
        accepts: request.accepts(["application/json", "text/html"]),
        types: request.types(),
        language: request.language(["en", "fr"]),
      }),
    );
  });
  const res = await hono.request("/n", {
    headers: {
      accept: "text/html,application/json;q=0.9",
      "accept-language": "fr,en;q=0.8",
    },
  });
  assert.deepEqual(await res.json(), {
    accepts: "text/html",
    types: ["text/html", "application/json"],
    language: "fr",
  });
});

test("request meta: hasBody, headers, ips", async () => {
  const hono = await build((r) => {
    r.post("/h", () =>
      json({ hasBody: request.hasBody(), ua: request.headers()["user-agent"], ips: request.ips() }),
    );
  });
  const res = await hono.request("/h", {
    method: "POST",
    headers: {
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
      "user-agent": "test-agent",
      "content-length": "2",
    },
    body: "hi",
  });
  assert.deepEqual(await res.json(), {
    hasBody: true,
    ua: "test-agent",
    ips: ["1.1.1.1", "2.2.2.2"],
  });
});

test("response: type, append, removeHeader, abortIf/abortUnless", async () => {
  const hono = await build((r) => {
    r.get("/type", () => {
      response.type("text/csv");
      return ctx().body("a,b");
    });
    r.get("/headers", () => {
      response.header("x-multi", "a").append("x-multi", "b");
      response.header("x-del", "1").removeHeader("x-del");
      return json({ ok: true });
    });
    r.get("/if", () => {
      response.abortIf(true, "nope", 403);
      return json({ ok: true });
    });
    r.get("/unless", () => {
      response.abortUnless(false, "no", 401);
      return json({ ok: true });
    });
  });

  assert.match((await hono.request("/type")).headers.get("content-type") ?? "", /text\/csv/);

  const h = await hono.request("/headers");
  assert.match(h.headers.get("x-multi") ?? "", /a.*b/);
  assert.equal(h.headers.get("x-del"), null);

  assert.equal((await hono.request("/if")).status, 403);
  assert.equal((await hono.request("/unless")).status, 401);
});
