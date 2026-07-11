// Type-check harness for docs/validation.md. Every type-checkable snippet in the
// guide is exercised here against the real exports, so a renamed method or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  json,
  validate,
  validateRequest,
  validated,
  request,
  response,
  ValidationException,
  Router,
  type Schema,
} from "@shaferllc/keel/core";
import { z } from "zod";

declare const Users: new (...a: unknown[]) => object;
declare const Posts: new (...a: unknown[]) => object;

export function declarative(router: Router) {
  const NewUser = z.object({ email: z.string().email(), name: z.string().min(1) });
  router.post("/users", [Users, "store"]).middleware([validateRequest({ body: NewUser })]);
  router.get("/posts/:id", [Posts, "show"]).middleware([
    validateRequest({
      params: z.object({ id: z.coerce.number() }),
      query: z.object({ page: z.coerce.number().min(1).default(1) }),
    }),
  ]);
}

export function readValidated() {
  const user = validated<{ email: string; name: string }>("body");
  const id = validated<{ id: number }>("params");
  const page = validated<{ page: number }>("query");
  return { user, id, page };
}

declare const email: string;
declare const age: number;
declare const err: unknown;

const NewUser = z.object({
  email: z.string().email(),
  age: z.number().min(18),
});

export class UserController {
  async store() {
    const data = await validate(NewUser); // { email: string; age: number }
    return json({ created: data.email }, 201);
  }
}

const Search = z.object({ q: z.string().min(1), page: z.coerce.number().default(1) });

export async function search() {
  const { q, page } = await validate(Search, request.query());
  return { q, page };
}

export async function mergedInput() {
  const data = await validate(NewUser, await request.all());
  return data;
}

export function handleError() {
  if (err instanceof ValidationException) {
    return response.json({ fields: err.errors }, 422);
  }
}

export async function reference() {
  const fromBody = await validate(NewUser);
  const fromData = await validate(NewUser, { email, age });
  return { fromBody, fromData };
}

// Schema<T> — hand-rolled implementation
const Positive: Schema<number> = {
  safeParse: (data) =>
    typeof data === "number" && data > 0
      ? { success: true, data }
      : { success: false, error: { issues: [{ path: [], message: "must be > 0" }] } },
};

export async function customSchema() {
  const n = await validate(Positive, 42); // number
  return n;
}

// ValidationException seam
export async function exceptionShape() {
  try {
    await validate(NewUser);
  } catch (e) {
    if (e instanceof ValidationException) {
      const status: number = e.status;
      const errors: Record<string, string[]> = e.errors;
      return { status, errors };
    }
  }
}
