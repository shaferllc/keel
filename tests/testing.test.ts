import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json, text, redirect, request } from "../src/core/request.js";
import { testClient, TestResponse } from "../src/core/testing.js";

async function app() {
  const application = new Application();
  await application.boot([], { discoverConfig: false, config: { app: {} } });
  const router = application.make(Router);
  router.get("/hello", () => text("hi"));
  router.get("/user", () => json({ id: 1, name: "Ada" }));
  router.post("/users", async () => {
    const b = await request.json<{ email: string }>();
    return json({ id: 2, email: b.email }, 201);
  });
  router.get("/old", () => redirect("/new", 302));
  return application;
}

test("verb helpers inject requests and read the response", async () => {
  const client = testClient(await app());
  const hello = await client.get("/hello");
  assert.equal(hello.status, 200);
  assert.equal(hello.text(), "hi");

  const user = await client.get("/user");
  assert.deepEqual(user.json(), { id: 1, name: "Ada" });
});

test("post sends a JSON body", async () => {
  const client = testClient(await app());
  const res = await client.post("/users", { email: "a@b.com" });
  assert.equal(res.status, 201);
  assert.deepEqual(res.json(), { id: 2, email: "a@b.com" });
});

test("fluent assertions pass for a matching response", async () => {
  const client = testClient(await app());
  const res = await client.post("/users", { email: "x@y.com" });
  res.assertStatus(201).assertOk().assertJson({ id: 2, email: "x@y.com" });
  const hello = await client.get("/hello");
  hello.assertText("hi");
  assert.match(hello.header("content-type") ?? "", /text\/plain/);
});

test("assertRedirect checks 3xx and location", async () => {
  const client = testClient(await app());
  (await client.get("/old")).assertRedirect("/new");
});

test("assertions throw with a helpful message on mismatch", async () => {
  const client = testClient(await app());
  const res = await client.get("/user");
  assert.throws(() => res.assertStatus(404), /Expected status 404, got 200/);
  assert.throws(() => res.assertJson({ id: 999 }), /JSON body mismatch/);
});

test("testClient accepts an Application, an HttpKernel, or a raw request()-able", async () => {
  const application = await app();
  assert.ok((await testClient(application).get("/hello")).status === 200);

  const kernel = new HttpKernel(application);
  assert.ok((await testClient(kernel).get("/hello")).status === 200);

  const hono = kernel.build();
  assert.ok((await testClient(hono).get("/hello")).status === 200);
});

test("TestResponse body can be read repeatedly (pre-buffered)", async () => {
  const client = testClient(await app());
  const res = await client.get("/user");
  assert.ok(res instanceof TestResponse);
  assert.deepEqual(res.json(), { id: 1, name: "Ada" });
  assert.deepEqual(res.json(), { id: 1, name: "Ada" }); // again — not consumed
  assert.equal(typeof res.text(), "string");
});
