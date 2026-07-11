import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { text, html, redirect, query, header, request, response } from "../src/core/request.js";

test("standalone response helpers build a Response without a request", () => {
  assert.match(text("hi").headers.get("content-type") ?? "", /text\/plain/);
  assert.match(html("<b>x</b>").headers.get("content-type") ?? "", /text\/html/);
  const r = redirect("/go", 301);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "/go");
});

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("request/response accessor variants inside a request", async () => {
  const hono = await build((r) => {
    r.get("/q", () =>
      response.text(`${query("q")}-${header("x-h")}-${request.query("q")}-${request.header("x-h")}`),
    );
    r.post("/j", async () =>
      response.json({ body: await request.json(), method: request.raw.method }),
    );
    r.get("/h", () => response.html("<i>ok</i>"));
    r.get("/r", () => response.redirect("/dest"));
    r.get("/all", () => response.json({ params: request.param(), query: query() }));
  });

  const q = await hono.request("/q?q=hi", { headers: { "x-h": "H" } });
  assert.equal(await q.text(), "hi-H-hi-H");

  const j = await hono.request("/j", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  });
  assert.deepEqual(await j.json(), { body: { a: 1 }, method: "POST" });

  assert.match((await hono.request("/h")).headers.get("content-type") ?? "", /text\/html/);

  const rr = await hono.request("/r");
  assert.equal(rr.status, 302);
  assert.equal(rr.headers.get("location"), "/dest");

  assert.equal((await hono.request("/all")).status, 200);
});

test("raw body accessors read non-JSON content types", async () => {
  const hono = await build((r) => {
    r.post("/xml", async () => response.text(`text:${await request.text()}`));
    r.post("/bin", async () => {
      const buf = await request.arrayBuffer();
      return response.json({ bytes: new Uint8Array(buf).length });
    });
    r.post("/blob", async () => {
      const blob = await request.blob();
      return response.json({ type: blob.type, size: blob.size });
    });
  });

  const xml = await hono.request("/xml", {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: "<note>hi</note>",
  });
  assert.equal(await xml.text(), "text:<note>hi</note>");

  const bin = await hono.request("/bin", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3, 4, 5]),
  });
  assert.deepEqual(await bin.json(), { bytes: 5 });

  const blob = await hono.request("/blob", {
    method: "POST",
    headers: { "content-type": "text/csv" },
    body: "a,b,c",
  });
  assert.deepEqual(await blob.json(), { type: "text/csv", size: 5 });
});
