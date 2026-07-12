# Starter kits

Five curated starter applications, produced by a generator, backed by three
opt-in core modules.

    npm create keeljs@latest my-app --preset saas

## The decisions, and why

**A generator, not template repos.** Every staleness bug this project has had came
from a copy of the framework living where the framework's CI couldn't see it:
`keel-app` sat on 0.78.2, keeljs.com sat on 0.78.2. N template repos multiply that
failure by N, and each one rots quietly and independently. One generator over one
template tree means a kit *cannot* lag the framework.

**Distinct trees, not composable layers.** Layers look DRY, but composition means
`+auth` and `+queue` both editing `bootstrap/providers.ts` — a merge engine, and a
2^n matrix nobody can test. Trees are dumb copies: the generator is ~50 lines, and
duplication is contained by CI booting every tree on every push. Duplication you can
test beats composition you can't.

**Templates ship inside the framework tarball** (`templates/`, alongside the already
shipped `docs/`). They version with the code they demonstrate, so the "which template
works with which framework version" question cannot be asked. CI boots them against
the working tree, so a breaking change to `HttpKernel` fails in the PR that broke it.

**The trees contain no security code.** That was the one genuinely rotten thing about
distinct trees: five copies of a password-reset flow means four that are quietly wrong
within a year. The flows live in core modules, tested once. A tree is views plus
wiring — a layout, a pricing page, three `.register()` calls.

## Core modules

Modeled exactly on `@shaferllc/keel/billing`, which is the working precedent: its own
export path, its own provider, its own routes, a *parameterized* migration factory
(`billingMigration(billableTable = "users")`), its own config stub. Not re-exported
from `core` — you mount it or it isn't in your bundle. (Billing imports `node:path`,
which core can't; the separate entry point is load-bearing for edge-safety, not just
tidy.)

| Module | Contains | Mounted by |
| --- | --- | --- |
| `@shaferllc/keel/accounts` | password reset, email verification, 2FA, session management | `app`, `saas` |
| `@shaferllc/keel/teams` | `Team`, `Membership`, roles, invitations, `TenantModel`, `runForTeam` | `saas` |
| `@shaferllc/keel/billing` | **exists today** | `saas` |

**`accounts` is flows, not primitives.** Guards, tokens, `auth()`, `session()` stay in
`core` — they're the primitive. `accounts` is what's built on them: routes, emails,
migrations. If they merge, `core` stops being edge-safe and starts shipping a users
table to people who never asked for one.

**`teams` and `billing` stay ignorant of each other.** A SaaS bills the *team*, not the
user — but billing already parameterizes that (`billableTable`), so the template points
it at teams. Neither module imports the other. This is what avoids a `keel/saas`
mega-module.

### Tenant isolation is deny-by-default

`Model.query()` is a one-line overridable static, and the framework has
`AsyncLocalStorage` request context, so `teams` ships:

```ts
class TenantModel extends Model {
  static override query() {
    return super.query().where("teamId", currentTeamId());  // throws with no team
  }
}
```

**No team in context is an error, not "unscoped."** A job, console command, or webhook
runs outside a request. The two soft options both fail badly: unscoped means every
background job sees *all tenants' rows* (this is how customer A's invoice reaches
customer B); `WHERE teamId = NULL` means jobs silently do nothing. So: throw, with one
explicit, greppable escape hatch.

```ts
runForTeam(team, () => sendInvoices())   // what a job actually does
withoutTenant(() => Post.query())        // deliberate, visible, auditable
```

The cost is real: **jobs crash until they're wrapped.** That's the point — it's a loud
failure in development instead of a silent leak in production. Same principle as
`bindModel({ scope })`, which 404s an out-of-scope row rather than 403ing it.

### 2FA: no half-authenticated session

A correct password on a 2FA account creates a half-state. The common implementation —
log them in, set `needs_2fa` on the session, check it in middleware — is **fake 2FA**:
the user holds a valid session, so every route that forgets the middleware and every
`auth()` call that only asks "is there a user?" is bypassable with just a password.

Instead: **no session exists until the code verifies.** The challenge is a short-lived,
single-purpose token — `encryption.encrypt({ userId }, { purpose: "2fa-challenge",
expires: "5m" })`, using the purpose+expiry primitive shipped in v0.65. Wrong purpose
won't decrypt, so a challenge can't be swapped for a session cookie or a reset token.
There is no half-authenticated state to forget to check, because there is none.

Verified edge-safe: **HMAC-SHA1 via WebCrypto works** (TOTP requires it; a `node:crypto`
import would have been a problem). `hash` for recovery codes (single-use, burned on
redemption), `encryption` for the TOTP secret at rest, `rate-limit.ts` on verification —
six digits in a 30-second window is trivially brute-forceable without it. QR as an
`otpauth://` URI rendered to inline SVG; no CDN, which would leak the shared secret to a
third party and break the edge preset's CSP.

2FA is **opt-in per user**, mounted by `saas`. Mandatory 2FA is the app owner's policy
call, not a starter kit's.

## The five presets

| Preset | Shape | Mounts |
| --- | --- | --- |
| `minimal` | routes, a controller, a JSX view, Tailwind. No database. | — |
| `api` | no views at all. Model + migration, token auth, OpenAPI, tests. | — |
| `app` *(default)* | full-stack: views, session auth, login/register | `accounts` |
| `saas` | `app` + teams, invitations, roles, billing, 2FA | `accounts`, `teams`, `billing` |
| `edge` | Workers + D1 + wrangler, no Node server | — |

Runtime is **folded in, not crossed**. Shape (minimal/api/app/saas) × runtime
(node/edge) would be ten trees — the 2^n we rejected layers to avoid. Nobody needs
"minimal-on-edge"; if a combination turns out to matter it becomes its own curated
tree, chosen deliberately.

Every preset is a tree CI must boot, typecheck, and hit with a request on every push.
Five is roughly two minutes. Ten would be the thing that makes someone turn the check
off — and a preset with no boot test is already broken and doesn't know it.

## The generator

`npm create keeljs@latest my-app --preset saas`

`create-keel` is **taken** on npm (a "coming soon" placeholder for keel.so), as is plain
`keel` — *"your production-grade backend from one file"*, an active framework in the same
category. `create-keeljs` is free and matches the domain already in use.

> Worth naming: every "just npm install keel" instinct a user has lands on someone
> else's project. `keeljs` as the public identity is the cheap fix, and now is when
> it's cheapest.

The package is ~50 lines: resolve `@shaferllc/keel@latest`, copy `templates/<preset>`,
rewrite `package.json`, install. A `keel` bin is added to the framework too (it ships
only `keel-mcp` today), so `npx @shaferllc/keel new my-app` funnels into the same path.

**A template's `package.json` must never hardcode a keel version.** It carries a
placeholder the generator rewrites to the version it resolved from — otherwise the
template pins a version older than itself, which is precisely the `^0.78.2` bug. On a
0.x version a caret only allows patches (`^0.79.0` means `>=0.79.0 <0.80.0`), so this
is not hypothetical; it is how both downstream repos went stale.

## Open, with recommendations

- **DB driver per preset.** libsql for `minimal`/`api`/`app` (zero-config, a file),
  Postgres for `saas` (nobody runs a real SaaS on SQLite), D1 for `edge`.
- **Tests in the trees.** Yes, in `api` and `saas` — a starter that ships no tests
  teaches that tests are optional. `testing.ts` already has the database assertions.
- **`keel-app`.** Archive it, README pointing at the generator. Keeping it alive as a
  sixth clonable thing puts us back where we started.
- **CI.** A matrix job per preset: generate, `npm ci`, typecheck, boot, one request.

## Build order

1. `accounts` (password reset, email verification, 2FA) — biggest core surface, and
   `app` is blocked on it.
2. `teams` (models, `TenantModel`, `runForTeam`, invitations, roles).
3. `templates/` + the boot matrix in CI — `minimal`, `api`, `app` first.
4. `create-keeljs` + the `keel` bin.
5. `saas` and `edge` trees; archive `keel-app`.
