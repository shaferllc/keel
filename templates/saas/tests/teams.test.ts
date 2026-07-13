import { test } from "node:test";
import assert from "node:assert/strict";

import { HttpKernel, testClient, hash } from "@shaferllc/keel/core";

import { createApplication } from "../bootstrap/app.js";

test("registering creates a personal team and lands on /teams", async () => {
  hash.fake();
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const registered = await client.form("/register", {
    name: "Ada",
    email: `ada+${crypto.randomUUID()}@example.com`,
    password: "correct horse battery",
  });

  assert.equal(registered.status, 302);
  assert.match(registered.header("location") ?? "", /\/teams/);
  hash.restore();
});

test("teams turn guests away", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  assert.equal((await client.get("/teams")).status, 302);
});

test("teams page bootstraps a personal team for users who have none", async () => {
  hash.fake();
  const app = await createApplication();
  let client = testClient(app.make(HttpKernel));

  const { User } = await import("../app/Models/User.js");
  const email = `solo+${crypto.randomUUID()}@example.com`;
  await User.create({
    name: "Solo",
    email,
    password: await hash.make("correct horse battery"),
  });

  const loggedIn = await client.form("/login", {
    email,
    password: "correct horse battery",
  });
  client = client.withCookies(loggedIn.cookies());

  const page = await client.get("/teams");
  page.assertOk();
  assert.match(await page.text(), /Solo's team/);

  hash.restore();
});

test("projects stay on the team that created them", async () => {
  hash.fake();
  const app = await createApplication();
  let ada = testClient(app.make(HttpKernel));
  let grace = testClient(app.make(HttpKernel));

  const adaReg = await ada.form("/register", {
    name: "Ada",
    email: `ada+${crypto.randomUUID()}@example.com`,
    password: "correct horse battery",
  });
  ada = ada.withCookies(adaReg.cookies());
  await ada.form("/projects", { name: "Ada secret project" });

  const graceReg = await grace.form("/register", {
    name: "Grace",
    email: `grace+${crypto.randomUUID()}@example.com`,
    password: "correct horse battery",
  });
  grace = grace.withCookies(graceReg.cookies());

  const graceTeams = await grace.get("/teams");
  graceTeams.assertOk();
  const html = await graceTeams.text();
  assert.doesNotMatch(html, /Ada secret project/);

  hash.restore();
});

test("subscribe redirects to FakeGateway checkout when Stripe keys are absent", async () => {
  hash.fake();
  process.env.BILLING_GATEWAY = "fake";

  const app = await createApplication();
  let client = testClient(app.make(HttpKernel));

  const registered = await client.form("/register", {
    name: "Ada",
    email: `ada+${crypto.randomUUID()}@example.com`,
    password: "correct horse battery",
  });
  client = client.withCookies(registered.cookies());

  (await client.get("/billing")).assertOk();

  const checkout = await client.form("/billing/subscribe", {});
  assert.equal(checkout.status, 302);
  assert.match(checkout.header("location") ?? "", /fake\.checkout/);

  hash.restore();
  delete process.env.BILLING_GATEWAY;
});
