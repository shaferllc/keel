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

test("request: proxy-aware URL accessors", async () => {
  const hono = await build((r) => {
    r.get("/u", () =>
      response.json({
        protocol: request.protocol,
        secure: request.secure,
        host: request.host,
        hostname: request.hostname,
        origin: request.origin,
        fullUrl: request.fullUrl,
        querystring: request.querystring,
      }),
    );
  });

  // Behind a TLS-terminating proxy: X-Forwarded-* win over the raw URL.
  const fwd = await hono.request("http://internal:3000/u?a=1&b=2", {
    headers: { "x-forwarded-proto": "https", "x-forwarded-host": "example.com" },
  });
  assert.deepEqual(await fwd.json(), {
    protocol: "https",
    secure: true,
    host: "example.com",
    hostname: "example.com",
    origin: "https://example.com",
    fullUrl: "https://example.com/u?a=1&b=2",
    querystring: "a=1&b=2",
  });

  // Direct request: falls back to the Host header / raw URL.
  const direct = await hono.request("http://localhost:8080/u", {
    headers: { host: "localhost:8080" },
  });
  const d = (await direct.json()) as Record<string, unknown>;
  assert.equal(d.protocol, "http");
  assert.equal(d.secure, false);
  assert.equal(d.hostname, "localhost");
  assert.equal(d.querystring, "");
});

test("response: back redirects to Referer, attachment sets Content-Disposition", async () => {
  const hono = await build((r) => {
    r.get("/back", () => response.back());
    r.get("/back-fb", () => response.back("/home"));
    r.get("/back-kw", () => redirect("back"));
    r.get("/dl", () => response.attachment("réport.csv").text("a,b"));
    r.get("/dl-bare", () => response.attachment().text("x"));
  });

  const withRef = await hono.request("/back", { headers: { referer: "/prev" } });
  assert.equal(withRef.headers.get("location"), "/prev");

  const noRef = await hono.request("/back-fb");
  assert.equal(noRef.headers.get("location"), "/home");

  const kw = await hono.request("/back-kw"); // no referer -> "/"
  assert.equal(kw.headers.get("location"), "/");

  const dl = await hono.request("/dl");
  const cd = dl.headers.get("content-disposition") ?? "";
  assert.match(cd, /attachment; filename="r\?port\.csv"/);
  assert.match(cd, /filename\*=UTF-8''r%C3%A9port\.csv/);

  const bare = await hono.request("/dl-bare");
  assert.equal(bare.headers.get("content-disposition"), "attachment");
});

test("request: encoding and charset negotiation", async () => {
  const hono = await build((r) => {
    r.get("/neg", () =>
      response.json({
        encoding: request.encoding(["br", "gzip"]),
        encodings: request.encodings(),
        charset: request.charset(["utf-8"]),
        noMatch: request.encoding(["deflate"]),
      }),
    );
  });

  const res = await hono.request("/neg", {
    headers: { "accept-encoding": "gzip, br;q=0.9", "accept-charset": "utf-8" },
  });
  assert.deepEqual(await res.json(), {
    encoding: "gzip",
    encodings: ["gzip", "br"],
    charset: "utf-8",
    noMatch: null,
  });
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
