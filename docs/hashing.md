# Hashing & Encryption

Password hashing and value encryption, both built on the Web Crypto API — so
they run identically on Node and the edge, with no native bindings (no `bcrypt`
to compile). Every operation is `async` (Web Crypto is promise-based), and the
core never reaches for a Node-only module, so the same code ships to a Worker or
a server unchanged.

## Hashing passwords

`hash.make()` produces a self-describing PBKDF2-SHA256 hash (algorithm,
iterations, salt, and digest are all encoded in the string):

```ts
import { hash } from "@shaferllc/keel/core";

const hashed = await hash.make(password);      // store this
await hash.verify(hashed, password);            // → true / false
```

The stored string is `pbkdf2_sha256$<iterations>$<base64 salt>$<base64 digest>` —
four `$`-joined fields. Because the salt and work factor travel with the digest,
`verify()` needs nothing but the stored string and the candidate password; there
is no separate salt column to manage.

Each call to `make()` draws a fresh 16-byte random salt, so hashing the same
password twice yields two different strings — both verify:

```ts
const a = await hash.make("hunter2");
const b = await hash.make("hunter2");
a === b;                          // false — different salts
await hash.verify(a, "hunter2");  // true
await hash.verify(b, "hunter2");  // true
```

Note the argument order: `verify(hashed, password)` — the **stored hash comes
first**, the plaintext second.

### Rotating the work factor

Rotate work factors over time — bump the iteration count and rehash on next
login, while the user's plaintext is in hand:

```ts
if (await hash.verify(user.password, plain)) {
  if (hash.needsRehash(user.password)) {
    user.password = await hash.make(plain);
    await user.save();
  }
}
```

The default is 100,000 iterations. To raise the bar, pass a higher count to
`make()` and check against the same number with `needsRehash()`:

```ts
const hashed = await hash.make(password, 200_000);
hash.needsRehash(hashed, 200_000);   // false — already at target
hash.needsRehash(hashed, 300_000);   // true  — below the new default
```

Verification is timing-safe (a constant-time compare of the derived digests),
and `verify()` returns `false` — never throws — for the common malformed cases:
wrong algorithm prefix or a missing field. A hash whose iteration field or salt
is unparsable is a corrupt store, not a wrong password (see the note on
`verify` in the reference).

### Faster tests

PBKDF2 is deliberately slow, which makes a test suite that creates lots of users
crawl. `hash.fake()` swaps in a trivial, **insecure** scheme (`make` returns
`fake$<password>`, `verify` just compares) so hashing is near-instant; `restore()`
brings back real PBKDF2. Call them in your test setup/teardown:

```ts
beforeEach(() => hash.fake());
afterEach(() => hash.restore());
```

Never call `fake()` outside tests.

## Encrypting values

`encryption` encrypts any JSON-serializable value with AES-GCM (a 256-bit key
derived by SHA-256 from `config('app.key')`, a fresh 12-byte IV per call). Use it
for tokens, opaque cookies, or anything you hand to a client and get back:

```ts
import { encryption } from "@shaferllc/keel/core";

const token = await encryption.encrypt({ userId: 1, scope: "reset" });
const data = await encryption.decrypt<{ userId: number }>(token);
// data → { userId: 1, scope: "reset" }  or  null if tampered / invalid
```

AES-GCM is authenticated: the tag is verified on decrypt, so any tampering with
the ciphertext (or a payload produced under a different key) fails the
authentication check. `decrypt()` turns that failure into `null` rather than
throwing — so a bad token is just an unauthenticated request, not a crash:

```ts
const value = await encryption.decrypt(untrustedInput);
if (value === null) return unauthorized();   // tampered, truncated, or wrong key
```

`encrypt()` round-trips anything `JSON.stringify` accepts — objects, arrays,
strings, numbers, booleans. It is not deterministic: the random IV means the same
input encrypts to a different string every time, so you can't use the ciphertext
as a lookup key.

### Expiring and purpose-bound tokens

`encrypt()` takes options that make the ciphertext self-expire and bind it to a
context — ideal for one-shot links like password resets or email confirmations:

```ts
const token = await encryption.encrypt(
  { userId: 1 },
  { expiresIn: "1h", purpose: "password-reset" },
);

// later — decrypt with the SAME purpose, or you get null
const data = await encryption.decrypt(token, { purpose: "password-reset" });
```

`expiresIn` is seconds or a duration string (`"30m"`, `"1h"`, `"7d"`); an expired
token decrypts to `null`. `purpose` binds the token to a use — decrypting with a
different purpose (or none) returns `null`, so a reset token can't be replayed as,
say, a login token. Both travel inside the ciphertext, so they can't be tampered
with. Tokens made without these options keep decrypting as before.

## The app key

Both encryption and [signed URLs](./url-builder.md) use `config('app.key')`. Set
a long, random `APP_KEY` and keep it secret:

```
APP_KEY=a-long-random-secret-value
```

If `app.key` is unset, `encrypt()` **throws** (`Encryption requires
config('app.key'). Set APP_KEY.`) — encryption can't proceed without a key. On
the read side `decrypt()` still returns `null` (the missing-key error is caught
alongside every other decrypt failure), so a misconfigured key surfaces as failed
decryption, not an exception.

Changing the key invalidates every previously encrypted value and signed URL —
old ciphertext no longer authenticates under the new key, so every prior token
decrypts to `null`.

---

## API reference

Two objects are exported: `hash` (password hashing) and `encryption` (reversible
value encryption). Both are plain objects — import and call their methods
directly; there's nothing to construct.

### `hash`

PBKDF2-SHA256 password hashing. All three methods work on the self-describing
string format `pbkdf2_sha256$<iterations>$<salt>$<digest>`.

#### `hash.make(password, iterations?)`

`make(password: string, iterations?: number): Promise<string>`

Hashes a password with PBKDF2-SHA256 and a fresh random 16-byte salt, returning
the self-describing hash string.

```ts
const hashed = await hash.make(password);        // 100,000 iterations
const stronger = await hash.make(password, 200_000);
```

**Notes:** `iterations` defaults to `100_000`. The salt is drawn from
`crypto.getRandomValues`, so the output differs on every call; the digest is
256-bit. Async because Web Crypto's `deriveBits` is. Store the whole returned
string — it carries everything `verify` needs.

#### `hash.verify(hashed, password)`

`verify(hashed: string, password: string): Promise<boolean>`

Re-derives the digest from `password` using the salt and iteration count embedded
in `hashed`, and compares it constant-time. **Stored hash first, plaintext
second.**

```ts
if (await hash.verify(user.password, submitted)) {
  // authenticated
}
```

**Notes:** the compare is timing-safe. Returns `false` (never throws) when the
algorithm prefix isn't `pbkdf2_sha256` or any of the four fields is missing.
Caveat: a hash with the right prefix but a *non-numeric* iteration field or an
*invalid-base64* salt slips past those guards and makes the underlying Web Crypto
call throw — so "never throws" holds for genuine wrong-password and simple
malformed cases, but not for a corrupted store. Treat your hash column as
trusted.

#### `hash.needsRehash(hashed, iterations?)`

`needsRehash(hashed: string, iterations?: number): boolean`

Returns `true` when `hashed` was made with fewer iterations than the given target
— your cue to re-hash the plaintext at the current work factor.

```ts
if (hash.needsRehash(user.password)) {
  user.password = await hash.make(plain);
}
```

**Notes:** synchronous (it just reads the iteration field). `iterations`
defaults to `100_000`. Returns `true` if the iteration field is absent or
unparsable (a `0`/`NaN` count reads as "below target"). Only meaningful right
after a successful `verify`, when you still hold the plaintext to re-hash.

### `encryption`

Authenticated (AES-GCM) encryption of JSON-serializable values, keyed by
`config('app.key')`.

#### `encryption.encrypt(value)`

`encrypt(value: unknown): Promise<string>`

JSON-serializes `value`, encrypts it with AES-GCM under a key derived from
`config('app.key')`, and returns a base64 string (IV prepended to the
ciphertext).

```ts
const token = await encryption.encrypt({ userId: 1, scope: "reset" });
```

**Notes:** each call uses a fresh random 12-byte IV, so the output is
non-deterministic — never use the ciphertext as a cache/lookup key. Throws
`Encryption requires config('app.key'). Set APP_KEY.` if the app key is unset.
`value` must survive `JSON.stringify` (no `undefined`, functions, or `BigInt`).

#### `encryption.decrypt(payload)`

`decrypt<T = unknown>(payload: string): Promise<T | null>`

Reverses `encrypt`: verifies the AES-GCM tag, decrypts, and `JSON.parse`s the
result. The type parameter types the resolved value.

```ts
const data = await encryption.decrypt<{ userId: number }>(token);
if (data === null) return unauthorized();
```

**Notes:** returns `null` — never throws — for any failure: tampered or truncated
ciphertext, a payload encrypted under a different key, malformed base64, or an
unset app key (all caught internally). `T` is a compile-time convenience; it does
not validate the decrypted shape at runtime.
