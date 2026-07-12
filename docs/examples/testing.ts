// Type-check harness for docs/testing.md. Compile-only — never executed.
import {
  Application,
  Router,
  HttpKernel,
  json,
  testClient,
  sessionMiddleware,
  requestLogger,
  type TestClient,
  type TestResponse,
} from "@shaferllc/keel/core";

declare const body: unknown;

type User = { id: number; email: string };

async function makeApp() {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/health", () => json({ ok: true }));
  return app;
}

export async function basic() {
  const client: TestClient = testClient(await makeApp());
  const res: TestResponse = await client.get("/health");
  res.assertStatus(200).assertJson({ ok: true });
}

export async function requests(client: TestClient) {
  await client.get("/users");
  await client.get("/users?active=true");
  await client.post("/users", { email: "a@b.com", name: "Ada" });
  await client.put("/users/1", { name: "Grace" });
  await client.delete("/users/1");
  await client.request("/users", { method: "POST", headers: { authorization: "Bearer x" }, body: JSON.stringify(body) });
}

export async function responseShape(client: TestClient) {
  const res = await client.get("/user");
  const s: number = res.status;
  const ct = res.header("content-type");
  const t: string = res.text();
  const u = res.json<User>();
  return { s, ct, t, u, raw: res.raw };
}

export async function assertions(client: TestClient) {
  const res = await client.post("/users", body);
  res
    .assertStatus(201)
    .assertOk()
    .assertJson({ id: 2 })
    .assertText("")
    .assertHeader("content-type", "application/json")
    .assertRedirect("/login");
}

export async function withMiddleware() {
  const app = await makeApp();
  const kernel = new HttpKernel(app);
  kernel.use(sessionMiddleware());
  kernel.use(requestLogger());
  return testClient(kernel);
}

/* --- Auth, forms, assertions, doubles, time, state, db, console --- */

import {
  spy,
  spyOn,
  restoreSpies,
  freezeTime,
  timeTravel,
  restoreTime,
  resetState,
  truncate,
  assertDatabaseHas,
  assertDatabaseMissing,
  assertDatabaseCount,
  assertDatabaseEmpty,
  runCommand,
  fakeMail,
  fakeQueue,
  swap,
  jwt,
  Job,
  type Spy,
  type CommandResult,
} from "@shaferllc/keel/core";

declare const bytes: Blob;
declare function notify(send: (message: string) => void): void;
declare function registerUser(user: { email: string }): Promise<void>;
declare const gateway: { charge(amount: number): string };
declare const receipt: string;
declare class PaymentGateway {}
declare class FakeGateway {}
declare class SendWelcome extends Job {
  handle(): Promise<void>;
}

export async function authenticatedRequests(client: TestClient) {
  const authed = client.withToken("tok_123");
  await authed.get("/me");
  await client.withBasicAuth("ada", "s3cret").get("/me");
  await client.withHeader("x-tenant", "acme").get("/me");
  await client.withHeaders({ "x-a": "1", "x-b": "2" }).get("/me");
  await client.withCookie("session", "abc").get("/me");
  await client.withCookies({ session: "abc" }).get("/me");
  await client.acceptJson().get("/me");
}

export async function formsAndUploads(client: TestClient) {
  await client.form("/login", { email: "a@b.com", password: "s3cret" });
  await client.multipart("/avatar", { file: bytes, name: "ada" });
}

export async function moreAssertions(client: TestClient) {
  const res = await client.get("/users/1");

  res.assertOk();
  res.assertCreated();
  res.assertNoContent();
  res.assertBadRequest();
  res.assertUnauthorized();
  res.assertForbidden();
  res.assertNotFound();
  res.assertUnprocessable();
  res.assertServerError();

  res.assertJsonContains({ user: { email: "a@b.com" } });
  res.assertSee("Welcome back");
  res.assertDontSee("Sign up");

  res.assertHeader("content-type", "application/json");
  res.assertHeaderMissing("x-debug");

  res.assertCookie("session");
  res.assertCookie("session", "abc123");
  res.assertCookieMissing("admin");

  res.assertValidationErrors("email", "password");
  res.assertNoValidationError("name");

  res.dump();
  return res.cookies();
}

export async function doubles() {
  const mailer = fakeMail();
  const queue = fakeQueue();

  await registerUser({ email: "ada@example.com" });

  mailer.assertQueued((m) => m.subject === "Welcome");
  queue.assertPushed(SendWelcome);

  swap(PaymentGateway, () => new FakeGateway());
}

export function spies() {
  const send: Spy<[string], void> = spy<[string], void>();
  notify(send);
  void send.callCount;
  void send.calledWith("hello");

  const charge = spyOn(gateway, "charge");
  charge.returns(receipt);
  restoreSpies();
}

export async function controllingTime() {
  freezeTime("2026-07-11T12:00:00Z");

  const token = await jwt.sign({ sub: "1" }, { expiresIn: "1h" });
  await jwt.verify(token);

  timeTravel(61 * 60 * 1000);
  await jwt.verify(token);

  restoreTime();
}

export async function stateReset() {
  resetState();
  await truncate("comments", "posts", "users");
}

export async function databaseAssertions() {
  await assertDatabaseHas("users", { email: "ada@example.com" });
  await assertDatabaseHas("users", { active: 1 }, 1);
  await assertDatabaseMissing("users", { email: "deleted@example.com" });
  await assertDatabaseCount("users", 1);
  await assertDatabaseEmpty("sessions");
}

declare function run(argv: string[]): Promise<void>;

export async function consoleTests(): Promise<CommandResult> {
  const result = await runCommand(() => run(["node", "keel", "routes"]));

  result
    .assertSucceeded()
    .assertOutputContains("GET  /users")
    .assertOutputMatches(/POST\s+\/users/);

  result.assertExitCode(0);
  void result.stdout;
  void result.stderr;
  void result.exitCode;

  return result;
}
