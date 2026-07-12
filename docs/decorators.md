# Request Decorators

Attach named, computed values to the current request — `request.user`,
`request.tenant`, `request.locale` — resolved **lazily** and **memoized for the
life of the request**. You register a resolver once, and Keel computes it on
first access and caches it per request. No null-placeholder declaration, no
shared-state leak between requests.

> Decorating the **application** is already the [service container's](./container.md)
> job — `bind` / `singleton` / `instance` / `make`, with `bound()` as
> `hasDecorator`. Decorators here are the per-*request* counterpart.

## Registering

Register decorators once at boot (typically in a service provider). A resolver
receives the request context and returns a value — sync or async:

```ts
import { decorateRequest } from "@shaferllc/keel/core";

decorateRequest("locale", (c) => c.req.header("accept-language") ?? "en");
decorateRequest("user", async (c) => findUser(c.req.header("authorization")));
```

## Accessing

Read a decorator anywhere in the request with `decorated()`. It runs the resolver
on first access and caches the result for the rest of that request:

```ts
import { decorated } from "@shaferllc/keel/core";

const locale = await decorated<string>("locale");
const user = await decorated<User | null>("user"); // computed once, then cached
```

`decorated()` always returns a promise (resolvers may be async). A second request
starts with a fresh cache — nothing leaks between requests.

## Setting a value directly

When something upstream already resolved a value — say an auth middleware — set it
imperatively so downstream `decorated()` calls skip the resolver:

```ts
import { setRequestValue, decorated } from "@shaferllc/keel/core";

// in middleware, after verifying the session:
setRequestValue("user", theAuthenticatedUser);

// later, in a controller:
const user = await decorated("user"); // returns the value set above, no re-lookup
```

## Why lazy + memoized

Resolving the current user (or tenant, or locale, or a feature-flag set) is the
kind of thing every handler needs but nothing should compute twice. Registering a
resolver once and letting the framework memoize it per request means:

- handlers that never touch `request.user` never pay for the lookup;
- handlers that touch it repeatedly pay exactly once;
- there's no per-request wiring to forget.

## API reference

### `decorateRequest(name, resolver)`

`decorateRequest<T>(name: string, resolver: (c: Context) => T | Promise<T>): void`

Registers a request decorator. The resolver is called at most once per request,
on first access.

```ts
decorateRequest("tenant", (c) => c.req.header("x-tenant") ?? "public");
```

**Notes:** throws if `name` is already registered (a collision guard). Register at
boot, not per request.

### `decorated(name)`

`decorated<T>(name: string): Promise<T>`

The memoized value of a decorator for the current request.

```ts
const tenant = await decorated<string>("tenant");
```

**Notes:** computes via the resolver on first access, caches for the rest of the
request. Throws if `name` was never registered. Must run inside a request (it
reads the current context).

### `setRequestValue(name, value)`

`setRequestValue<T>(name: string, value: T): void`

Sets a decorator's value for the current request, overriding the resolver.

**Notes:** later `decorated(name)` calls return this value without invoking the
resolver. Useful from middleware.

### `hasRequestDecorator(name)`

`hasRequestDecorator(name: string): boolean`

Whether a decorator has been registered.

### `clearRequestDecorators()`

`clearRequestDecorators(): void`

Unregisters all decorators — a test helper.

### Interfaces & types

#### `RequestResolver`

`type RequestResolver<T> = (c: Context) => T | Promise<T>`

The function registered with `decorateRequest`; receives the Hono `Context` and
returns the value (sync or async).
