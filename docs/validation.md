# Validation

`validate()` parses request input against a schema and returns typed data. If
the input is invalid it throws a `ValidationException`, which the HTTP kernel
renders as a `422` with per-field errors — no manual checking.

## Bring a schema library

Keel's `validate()` is schema-agnostic: it works with any schema that has a
Zod-style `safeParse`. [Zod](https://zod.dev) is the recommended choice — the
framework never bundles it, so install it in your app:

```bash
npm install zod
```

Nothing about `validate()` is Zod-specific: it only ever calls `schema.safeParse(input)`
and reads back `.success`, `.data`, and `.error.issues`. Anything that mirrors
that shape (see the [`Schema`](#schemat) type) works — including a hand-rolled
validator or a mock in a test.

## Validating a request body

Call `validate(schema)` with no data and it parses the JSON body. The result is
fully typed from the schema:

```ts
import { json, validate } from "@shaferllc/keel/core";
import { z } from "zod";

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
```

Invalid input never reaches your logic — it becomes a 422:

```jsonc
// POST /users  { "email": "nope", "age": 15 }
{
  "error": "The given data was invalid.",
  "status": 422,
  "errors": {
    "email": ["Invalid email address"],
    "age": ["Too small: expected number to be >=18"]
  }
}
```

## Validating other input

Pass data explicitly to validate anything — query strings, params, config.
`validate()` is `async` in **both** forms, so `await` it even when you hand it
data directly:

```ts
import { validate, request } from "@shaferllc/keel/core";

const Search = z.object({ q: z.string().min(1), page: z.coerce.number().default(1) });

async function search() {
  const { q, page } = await validate(Search, request.query());
  // …
}
```

The rule is simple: if the second argument is anything other than `undefined`,
`validate()` parses that value; if it's omitted, it awaits the JSON body. Because
the check is `data !== undefined`, passing `null` counts as "explicit data" — the
schema sees `null`, not the body.

## Body parsing is JSON-only

The no-argument form reads the body with `body()`, which calls `request.json()`.
That means `validate(schema)` expects a JSON request body; a form-encoded or empty
body will reject at JSON parse time before the schema even runs. If you need to
validate merged query + form input, pass it in explicitly:

```ts
import { validate, request } from "@shaferllc/keel/core";

// request.all() merges the query string with the parsed body (JSON or form)
const data = await validate(NewUser, await request.all());
```

## The error shape

On failure `validate()` walks `error.issues` and folds them into a
`Record<string, string[]>` — one array of messages per field:

- Each issue's `path` is joined with `.` into a key: a nested path
  `["address", "zip"]` becomes `"address.zip"`.
- Symbol path segments use their `.description`; everything else is stringified.
- A **root-level** issue (empty path) is keyed `"_"`.
- Multiple issues on the same path accumulate in that field's array.

```jsonc
// nested + root-level errors
{
  "errors": {
    "address.zip": ["Invalid postal code"],
    "_": ["Passwords do not match"]
  }
}
```

That map is exactly what `ValidationException.errors` carries.

## Handling errors yourself

`ValidationException` carries the field errors, so a custom error handler (see
[Errors](./errors.md)) can format them however you like:

```ts
import { ValidationException } from "@shaferllc/keel/core";

if (err instanceof ValidationException) {
  return response.json({ fields: err.errors }, 422);
}
```

---

## API reference

### `validate(schema, data?)`

`validate<T>(schema: Schema<T>, data?: unknown): Promise<T>`

Parses `data` (or the JSON request body, when `data` is omitted) against `schema`
and resolves to the typed value, throwing `ValidationException` on failure.

```ts
import { validate } from "@shaferllc/keel/core";
import { z } from "zod";

const NewUser = z.object({ email: z.string().email(), age: z.number().min(18) });

const fromBody = await validate(NewUser);                 // parses request.json()
const fromData = await validate(NewUser, { email, age }); // parses the given value
```

**Notes:** always returns a `Promise`, in both forms — `await` it even when you
pass data. The body form calls `body()` (`request.json()`), so it expects a JSON
body. The "use my data" branch triggers on `data !== undefined`, so `null` is
treated as explicit input (the schema sees `null`). On failure it throws
`ValidationException` whose `errors` is a `Record<string, string[]>` keyed by
dotted field path (root-level issues key `"_"`); it never returns a partial
result. `T` is inferred from the schema, so the resolved value is fully typed.

### Interfaces & types

#### `Schema<T>`

```ts
interface Schema<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> };
      };
}
```

The minimal contract `validate()` needs from a schema — a single `safeParse` that
returns a discriminated `success` union. Zod's `z.object({...})` satisfies it out
of the box, which is why you normally never write this type by hand. Implement it
yourself only to plug in a different validator or a test stub:

```ts
import { validate, type Schema } from "@shaferllc/keel/core";

const Positive: Schema<number> = {
  safeParse: (data) =>
    typeof data === "number" && data > 0
      ? { success: true, data }
      : { success: false, error: { issues: [{ path: [], message: "must be > 0" }] } },
};

const n = await validate(Positive, 42); // number
```

**Notes:** `validate()` only reads `success`, `data`, and `error.issues` (each
issue's `path` and `message`). It ignores every other field a real Zod result
carries, so any object matching this shape is enough. An issue with an empty
`path` (as above) lands under the `"_"` key in the thrown errors.

#### `ValidationException`

`new ValidationException(errors: Record<string, string[]>, message?: string)`

The 422 exception `validate()` throws on failure; re-exported from the framework's
[HTTP exceptions](./errors.md). You rarely construct it — you catch it.

```ts
import { ValidationException } from "@shaferllc/keel/core";

try {
  await validate(NewUser);
} catch (err) {
  if (err instanceof ValidationException) {
    err.status; // 422
    err.errors; // Record<string, string[]>, per-field messages
  }
}
```

**Notes:** extends `HttpException` with `status` fixed at `422` and a default
`message` of `"The given data was invalid."`. The per-field `errors` map is the
one `validate()` built from the schema's issues. See [Errors](./errors.md) for
how the kernel renders it and how to override that.
