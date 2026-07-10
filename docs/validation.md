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

Pass data explicitly to validate anything — query strings, params, config:

```ts
import { validate, request } from "@shaferllc/keel/core";

const Search = z.object({ q: z.string().min(1), page: z.coerce.number().default(1) });

search() {
  const { q, page } = validate(Search, request.query());
  // …
}
```

## Handling errors yourself

`ValidationException` carries the field errors, so a custom error handler (see
[Errors](./errors.md)) can format them however you like:

```ts
import { ValidationException } from "@shaferllc/keel/core";

if (err instanceof ValidationException) {
  return response.json({ fields: err.errors }, 422);
}
```
