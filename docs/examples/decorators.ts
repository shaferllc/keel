// Type-check harness for docs/decorators.md. Compile-only — never executed.
import {
  decorateRequest,
  decorated,
  setRequestValue,
  hasRequestDecorator,
  clearRequestDecorators,
  type RequestResolver,
} from "@shaferllc/keel/core";

type User = { id: number; name: string };
declare function findUser(auth: string | undefined): Promise<User | null>;

export function registering() {
  decorateRequest("locale", (c) => c.req.header("accept-language") ?? "en");
  decorateRequest("user", async (c) => findUser(c.req.header("authorization")));
  decorateRequest("tenant", (c) => c.req.header("x-tenant") ?? "public");
}

export async function accessing() {
  const locale = await decorated<string>("locale");
  const user = await decorated<User | null>("user");
  const tenant = await decorated<string>("tenant");
  return { locale, user, tenant };
}

export async function setting(theUser: User) {
  setRequestValue("user", theUser);
  return decorated<User>("user");
}

export function introspection() {
  const has = hasRequestDecorator("user");
  clearRequestDecorators();
  return has;
}

// The resolver type
const resolver: RequestResolver<string> = (c) => c.req.path;
export { resolver };
