import { test } from "node:test";
import assert from "node:assert/strict";

import { HttpKernel, testClient } from "@shaferllc/keel/core";

import { createApplication } from "../bootstrap/app.js";

/**
 * The no-credentials case — which is what a fresh clone, and CI, actually run.
 *
 * It gets its own file because config is read once per process, on the first boot: a
 * sibling test that sets GITHUB_CLIENT_ID would poison this one. Node's test runner
 * gives each file its own process, so the two can't see each other's environment.
 *
 * The promise being tested is the same one billing makes with Stripe: with nothing
 * configured, the feature disappears cleanly instead of half-appearing and failing.
 */

test("no social buttons are rendered when nothing is configured", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const page = await client.get("/login");
  page.assertOk();

  const html = page.text();
  assert.doesNotMatch(html, /Continue with GitHub/);
  assert.doesNotMatch(html, /Continue with Google/);

  // Not just the buttons — the "or" divider goes too, so the page looks untouched.
  assert.doesNotMatch(html, /href="\/auth\/github"/);
});

test("an unconfigured provider's route is refused rather than bouncing to an OAuth error", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  // Someone hitting /auth/github directly on an app with no credentials should get a
  // 403 from us, not a redirect to GitHub's own "bad client_id" page.
  assert.equal((await client.get("/auth/github")).status, 403);
});
