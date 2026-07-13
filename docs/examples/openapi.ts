// Type-check harness for docs/openapi.md. Compile-only — never executed.
import { z } from "zod";
import { Application, Router, validateRequest, type Ctx } from "@shaferllc/keel/core";
import { OpenApiServiceProvider, apiDoc, OpenApi } from "@shaferllc/keel/openapi";

const NewUser = z.object({ email: z.string().email(), age: z.number().min(18) });
const UserShape = z.object({ id: z.number(), email: z.string().email() });

class Users {
  store(_c: Ctx) {
    return { id: 1, email: "a@b.com" };
  }
}

export function install() {
  const app = new Application();
  app.register(OpenApiServiceProvider);
  OpenApi.auth((c) => c.req.header("x-docs-key") === "secret");
  return app;
}

export function document(router: Router) {
  router
    .post("/users", [Users, "store"])
    .name("users.store")
    .config(
      apiDoc({
        summary: "Create a user",
        tags: ["users"],
        request: { body: NewUser },
        responses: { 201: { description: "The created user", schema: UserShape } },
      }),
    )
    .middleware([validateRequest({ body: NewUser })]);
}
