import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HttpKernel,
  MemoryDriver,
  fakeQueue,
  hash,
  restoreQueue,
  scheduler,
  setQueue,
  testClient,
  work,
} from "@shaferllc/keel/core";

import { createApplication } from "../bootstrap/app.js";
import { SendVerificationEmailJob } from "../app/Jobs/SendVerificationEmailJob.js";

const password = "correct horse battery";

async function register(app: Awaited<ReturnType<typeof createApplication>>) {
  const client = testClient(app.make(HttpKernel));
  const response = await client.form("/register", {
    name: "Ada",
    email: `ada+${crypto.randomUUID()}@example.com`,
    password,
  });

  return { response, client: client.withCookies(response.cookies()) };
}

test("signing up queues the verification email instead of sending it on the request", async () => {
  hash.fake();
  const app = await createApplication();

  // Records dispatches without running them, so this proves the email was *queued*
  // without paying to send it.
  const queue = fakeQueue();

  const { response } = await register(app);
  assert.equal(response.status, 302, "registration succeeded");

  queue.assertPushed(SendVerificationEmailJob);

  restoreQueue();
  hash.restore();
});

test("a queued job actually runs when the queue is drained", async () => {
  hash.fake();
  const app = await createApplication();

  // MemoryDriver holds jobs until work() runs them — the same shape the Node
  // BackgroundServiceProvider uses, minus the timer.
  const driver = new MemoryDriver();
  setQueue(driver);

  await register(app);
  assert.equal(driver.size, 1, "the email is waiting, not sent inline");

  const ran = await work();
  assert.equal(ran, 1, "draining ran it");
  assert.equal(driver.failed.length, 0, "and it didn't fail");
  assert.equal(driver.size, 0, "the queue is empty again");

  hash.restore();
});

/**
 * A regression test for a bug that shipped: `invite()` sends the invitation email
 * itself, and with no `teams.mail.from` configured the message had no from address, so
 * every invite threw and returned a 500. The kit had no test that ever POSTed to
 * /teams/invite, so nothing noticed. config/teams.ts is the fix.
 */
test("inviting someone succeeds and records a pending invitation", async () => {
  hash.fake();
  const app = await createApplication();

  const { client } = await register(app);

  const invited = await client.form("/teams/invite", {
    email: "grace@example.com",
    role: "member",
  });

  assert.equal(invited.status, 302, "the invite went through — a 500 here means no mail.from");

  const teams = await client.get("/teams");
  teams.assertOk();
  assert.match(teams.text(), /grace@example\.com/, "it shows up as pending");

  hash.restore();
});

test("the invitation prune task is scheduled", async () => {
  await createApplication();

  const names = scheduler().tasks.map((t) => t.name);
  assert.ok(names.includes("prune-invitations"), "ScheduleServiceProvider registered it");
});
