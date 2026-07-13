# Hosting

Keel Hosting is a small toolkit for **hosted Workers / D1 apps**: a Cloudflare
REST client, hostname helpers, a SQLite-compatible SQL dump, and purpose-scoped
secret encryption. It ships as `@shaferllc/keel/hosting`.

This is infrastructure — not a control plane. Site orchestration, plans, and
deploy loops live in your app (for example Keel Cloud).

## Install

```ts
import {
  CloudflareClient,
  cloudflareConfigured,
  normalizeHostname,
  isValidHostname,
  zoneCandidates,
  dumpConnection,
  normalizeSecretKey,
  encryptSecretValue,
  decryptSecretValue,
  resolveSecretRows,
} from "@shaferllc/keel/hosting";
```

No service provider — import what you need.

## Cloudflare

```ts
const creds = {
  accountId: process.env.CF_ACCOUNT_ID!,
  apiToken: process.env.CF_API_TOKEN!,
};

if (!cloudflareConfigured(creds)) {
  throw new Error("Cloudflare credentials missing");
}

const cf = new CloudflareClient(creds);
const db = await cf.createD1Database("kc-acme");
```

Credentials are constructor args — no app config coupling. Optional
`pinnedZoneId` / `pinnedZoneName` skip a zone lookup when you already know the
primary zone.

## Hostnames

```ts
const host = normalizeHostname("https://App.Example.com/"); // "app.example.com"
isValidHostname(host); // true
zoneCandidates(host);  // ["app.example.com", "example.com"]
```

`zoneCandidates` walks from most-specific to apex — useful when attaching a
Workers Custom Domain and you need to find which zone owns the name.

## SQL dump

Dump any SQLite-compatible `Connection` to a portable `.sql` script (schema +
data). Useful for export / escape hatches:

```ts
import { db } from "@shaferllc/keel/core";
import { dumpConnection } from "@shaferllc/keel/hosting";

const sql = await dumpConnection(db(), "Acme local D1", { generatedBy: "Keel Cloud" });
// write sql to a .sql file; restore with sqlite3 / D1 import
```

## Secrets

Encrypt vault values with Keel's purpose-scoped encryption (`config('app.key')`
must be set). Keys are normalized to `ENV_STYLE` identifiers:

```ts
const key = normalizeSecretKey("stripe-secret-key"); // "STRIPE_SECRET_KEY"
const encrypted = await encryptSecretValue(secret, "app-secret");
const plain = await decryptSecretValue(encrypted, "app-secret");

const env = await resolveSecretRows(
  [{ key: "STRIPE_SECRET_KEY", value_encrypted: encrypted }],
  "app-secret",
);
// { STRIPE_SECRET_KEY: "…" }
```

Your app owns the table of rows (`owner_id`, `key`, `value_encrypted`); hosting
only encrypts and decrypts.

## Related

- [Gates](./gates.md) — private-alpha signup gating used by hosted control planes
- [Starter kits](./starter-kits.md) — presets Cloud scaffolds from
- [Building with AI](./ai.md) — MCP Cloud tools (`keel_cloud_*`) that drive hosting
