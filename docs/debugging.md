# Debugging

Two helpers for the moments you'd otherwise reach for `console.log`.

## dump

`dump(...values)` prints to the console and **returns its first argument**, so
you can drop it inline without restructuring code:

```ts
import { dump } from "@shaferllc/keel/core";

dump(user, order);                 // logs both, execution continues

const total = dump(computeTotal()); // logs the total AND uses it
```

It handles circular references, functions, and bigints safely.

## dd — dump and die

`dd(...values)` dumps to the **browser** and halts the request — a readable HTML
page with each value pretty-printed. Perfect for inspecting state mid-request:

```ts
import { dd } from "@shaferllc/keel/core";

store() {
  dd(await request.all(), request.headers());
  // never reached
}
```

Under the hood `dd()` throws a self-rendering exception (see
[Errors](./errors.md)), so it works the same on Node and the edge — no special
runtime support needed.

## Turning on framework debug output

Set `APP_DEBUG=true` (i.e. `config('app.debug')`) to get full error pages with
stack traces from the kernel. Turn it off in production so internals stay hidden.
See [Errors](./errors.md) for how responses change between debug and production.
