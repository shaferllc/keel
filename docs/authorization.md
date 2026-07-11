# Authorization

Where [authentication](./authentication.md) answers *who you are*, authorization
answers *what you're allowed to do*. Keel gives you **gates** (ad-hoc abilities)
and **policies** (abilities grouped per model) — a compact authorization layer.

The current user is resolved from `auth().user()` by default, so authorization
composes with the session auth you already have.

## Gates

A gate is a named ability with a callback that receives the user and whatever you
pass to the check:

```ts
import { define, can, authorize } from "@shaferllc/keel/core";

// register once, at boot (e.g. in a service provider):
define("update-post", (user, post) => post.authorId === user.id);
define("access-admin", (user) => user.role === "admin");

// check anywhere:
if (await can("update-post", post)) {
  // …
}

await authorize("update-post", post); // throws a 403 ForbiddenException if denied
```

`can(ability, ...args)` returns a boolean; `cannot(...)` is its negation;
`authorize(...)` throws a `403` when denied (the HTTP kernel renders it).

## Policies

For a model with several abilities, group them in a **policy** class — one method
per ability — and register it. `can("update", post)` then routes to
`PostPolicy.update(user, post)` automatically, by the argument's class:

```ts
import { policy, can } from "@shaferllc/keel/core";

class PostPolicy {
  view(user, post) {
    return post.published || post.authorId === user.id;
  }
  update(user, post) {
    return post.authorId === user.id;
  }
  delete(user, post) {
    return user.admin || post.authorId === user.id;
  }
}

policy(Post, PostPolicy); // register the class (or an instance)

await can("view", post);            // → PostPolicy.view(user, post)
await authorize("delete", post);    // → PostPolicy.delete(user, post) or 403
```

A policy is a plain class — no base class, no framework glue. The method name is
the ability; the first argument to the check is the model.

## Admin bypass (before hooks)

Register a `gateBefore` callback to decide checks up front — return a boolean to
short-circuit, or `undefined` to fall through to the gate/policy. Perfect for a
super-admin:

```ts
import { gateBefore } from "@shaferllc/keel/core";

gateBefore((user) => (user.role === "superadmin" ? true : undefined));
```

## In a controller

```ts
export class PostController {
  async update(c: Ctx) {
    const post = await Post.findOrFail(param("id"));
    await authorize("update", post); // 403 unless allowed
    // … safe to proceed
  }
}
```

## Checking a specific user

`can`/`authorize` use the current user. To check someone else (background jobs,
tests, impersonation), use the `For` variants:

```ts
import { canFor, authorizeFor } from "@shaferllc/keel/core";

await canFor(otherUser, "update-post", post);
await authorizeFor(otherUser, "update-post", post);
```

Resolving the current user differently (token auth instead of session)?
`setUserResolver(() => currentUserSomehow())`.

## API reference

### `define(ability, callback)`

`define(ability: string, callback: (user, ...args) => boolean | Promise<boolean>): void`

Registers a gate. The callback receives the resolved user and the check
arguments.

### `policy(model, impl)`

`policy(model: Constructor, impl: Policy | (new () => Policy)): void`

Registers a policy (class or instance) for a model. `can(ability, instance)`
routes to `impl[ability](user, instance)` when the ability matches a method.

### `can(ability, ...args)` / `cannot(...)`

`can(ability: string, ...args): Promise<boolean>`

Whether the current user is allowed. `cannot` is the negation. Policy (matching
model argument) is tried first, then a gate; unknown abilities **deny**.

### `authorize(ability, ...args)`

`authorize(ability: string, ...args): Promise<void>`

Throws a `403` `ForbiddenException` unless allowed.

### `canFor(user, ...)` / `authorizeFor(user, ...)`

The `can` / `authorize` pair for an explicit user rather than the current one.

### `gateBefore(callback)`

`gateBefore(callback: (user, ability, args) => boolean | undefined | Promise<…>): void`

Runs before every check; a boolean short-circuits, `undefined` falls through.

### `setUserResolver(resolver)` / `clearAuthorization()`

Override how the current user is resolved (default `auth().user()`), and reset
all gates/policies/hooks (a test helper).

### Interfaces & types

#### `GateCallback`

`type GateCallback = (user: unknown, ...args: unknown[]) => boolean | Promise<boolean>`

#### `BeforeCallback`

`type BeforeCallback = (user, ability: string, args: unknown[]) => boolean | undefined | Promise<boolean | undefined>`
