# URL Builder

Generate URLs from **named routes** so paths live in one place. Name a route,
then build its URL by name — with params and query strings — and never hardcode
a path again.

## Building URLs

```ts
router.get("/users/:id", [UserController, "show"]).name("users.show");

router.url("users.show", { id: 42 });
// "/users/42"

router.url("users.show", { id: 42 }, { qs: { tab: "posts", page: 2 } });
// "/users/42?tab=posts&page=2"
```

## Signed URLs

A signed URL carries a tamper-proof signature — perfect for one-off links
(email confirmations, unsubscribe, downloads) where you want to trust the
parameters without a database lookup. Signing uses `config('app.key')`, so set
an `APP_KEY`:

```ts
// generate (async — uses Web Crypto, works on Node and the edge)
const url = await router.signedUrl("download", { id: 7 });
const expiring = await router.signedUrl("download", { id: 7 }, { expiresIn: 3600 });
```

Verify the incoming request in your handler or a middleware:

```ts
show() {
  if (!(await router.hasValidSignature())) {
    return response.abort("Invalid or expired link", 403);
  }
  // …trusted params
}
```

`hasValidSignature()` returns `false` if the signature is missing, the URL was
tampered with, or an `expires` timestamp has passed.

## Notes

- Signatures cover the path **and** query string, so changing any parameter
  invalidates the link.
- The signing key must be stable and secret. Set `APP_KEY` to a long random
  value (and keep it out of source control).
