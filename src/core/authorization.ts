/**
 * Authorization — gates and policies over the top of authentication. Where
 * `auth()` answers *who you are*, this answers *what you're allowed to do*.
 *
 *   // a gate: an ad-hoc ability
 *   define("update-post", (user, post) => post.authorId === user.id);
 *   if (await can("update-post", post)) { ... }
 *   await authorize("update-post", post);        // throws 403 otherwise
 *
 *   // a policy: abilities grouped per model
 *   class PostPolicy {
 *     update(user, post) { return post.authorId === user.id; }
 *     delete(user, post) { return user.admin || post.authorId === user.id; }
 *   }
 *   policy(Post, PostPolicy);
 *   await can("update", post);                    // routes to PostPolicy.update
 *
 * The current user is resolved from `auth().user()` by default; override with
 * `setUserResolver` (e.g. token auth) or check a specific user with `canFor`.
 */

import { ForbiddenException } from "./exceptions.js";
import { auth } from "./auth.js";

type User = unknown;
type Args = unknown[];
type Constructor = new (...args: never[]) => object;

/** A gate callback — receives the user and the checked arguments. */
export type GateCallback = (user: User, ...args: Args) => boolean | Promise<boolean>;
type PolicyMethod = (user: User, ...args: Args) => boolean | Promise<boolean>;
type Policy = Record<string, PolicyMethod | undefined>;
/** Runs before every check; return a boolean to short-circuit (e.g. admin bypass). */
export type BeforeCallback = (
  user: User,
  ability: string,
  args: Args,
) => boolean | undefined | Promise<boolean | undefined>;

const gates = new Map<string, GateCallback>();
const policies = new Map<Constructor, Policy>();
let beforeCallback: BeforeCallback | undefined;
let userResolver: () => User | Promise<User> = () => auth().user();

/** Define a gate — an ad-hoc ability keyed by name. */
export function define(ability: string, callback: GateCallback): void {
  gates.set(ability, callback);
}

/**
 * Register a policy (instance or class) for a model — its methods are abilities.
 * `impl` is intentionally loose (`object` / class) so a normally-typed policy
 * class — `update(user: User, post: Post)` — fits without wrestling the compiler.
 */
export function policy(model: Constructor, impl: object | (new () => object)): void {
  const instance = typeof impl === "function" ? new (impl as new () => object)() : impl;
  policies.set(model, instance as Policy);
}

/** Register a callback that runs before every check (return a boolean to decide). */
export function gateBefore(callback: BeforeCallback): void {
  beforeCallback = callback;
}

/** Override how the "current user" is resolved (default: `auth().user()`). */
export function setUserResolver(resolver: () => User | Promise<User>): void {
  userResolver = resolver;
}

/** Reset gates, policies, the before-hook, and the resolver (test helper). */
export function clearAuthorization(): void {
  gates.clear();
  policies.clear();
  beforeCallback = undefined;
  userResolver = () => auth().user();
}

async function evaluate(user: User, ability: string, args: Args): Promise<boolean> {
  if (beforeCallback) {
    const decided = await beforeCallback(user, ability, args);
    if (typeof decided === "boolean") return decided;
  }
  // Policy: the first argument is a model with a registered policy + matching method.
  const subject = args[0];
  if (subject && typeof subject === "object") {
    const found = policies.get((subject as object).constructor as Constructor);
    const method = found?.[ability];
    if (typeof method === "function") return Boolean(await method.call(found, user, ...args));
  }
  const gate = gates.get(ability);
  if (gate) return Boolean(await gate(user, ...args));
  return false; // unknown ability — deny by default
}

/** Whether the current user is allowed the ability (with the given arguments). */
export async function can(ability: string, ...args: Args): Promise<boolean> {
  return evaluate(await userResolver(), ability, args);
}

/** The negation of `can`. */
export async function cannot(ability: string, ...args: Args): Promise<boolean> {
  return !(await can(ability, ...args));
}

/** Like `can`, but for a specific user rather than the current one. */
export async function canFor(user: User, ability: string, ...args: Args): Promise<boolean> {
  return evaluate(user, ability, args);
}

/** Throw a 403 `ForbiddenException` unless the current user is allowed. */
export async function authorize(ability: string, ...args: Args): Promise<void> {
  if (!(await can(ability, ...args))) {
    throw new ForbiddenException(`Unauthorized: ${ability}`);
  }
}

/** Like `authorize`, but for a specific user. */
export async function authorizeFor(user: User, ability: string, ...args: Args): Promise<void> {
  if (!(await canFor(user, ability, ...args))) {
    throw new ForbiddenException(`Unauthorized: ${ability}`);
  }
}
