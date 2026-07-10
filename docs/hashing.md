# Hashing & Encryption

Password hashing and value encryption, both built on the Web Crypto API — so
they run identically on Node and the edge, with no native bindings (no `bcrypt`
to compile).

## Hashing passwords

`hash.make()` produces a self-describing PBKDF2-SHA256 hash (algorithm,
iterations, salt, and digest are all encoded in the string):

```ts
import { hash } from "@shaferllc/keel/core";

const hashed = await hash.make(password);      // store this
await hash.verify(hashed, password);            // → true / false
```

Rotate work factors over time — bump the iteration count and rehash on next
login:

```ts
if (await hash.verify(user.password, plain)) {
  if (hash.needsRehash(user.password)) {
    user.password = await hash.make(plain);
    await user.save();
  }
}
```

Verification is timing-safe, and `verify()` returns `false` (never throws) on a
malformed hash.

## Encrypting values

`encryption` encrypts any JSON-serializable value with AES-GCM, keyed by
`config('app.key')`. Use it for tokens, opaque cookies, or anything you hand to
a client and get back:

```ts
import { encryption } from "@shaferllc/keel/core";

const token = await encryption.encrypt({ userId: 1, scope: "reset" });
const data = await encryption.decrypt<{ userId: number }>(token);
// data → { userId: 1, scope: "reset" }  or  null if tampered / invalid
```

`decrypt()` returns `null` rather than throwing when the payload was tampered
with or was signed under a different key — so a bad token is just an
unauthenticated request, not a crash.

## The app key

Both encryption and [signed URLs](./url-builder.md) use `config('app.key')`. Set
a long, random `APP_KEY` and keep it secret:

```
APP_KEY=a-long-random-secret-value
```

Changing the key invalidates every previously encrypted value and signed URL.
