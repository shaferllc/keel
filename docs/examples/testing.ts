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
