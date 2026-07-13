# create-keeljs

Scaffold a [Keel](https://github.com/shaferllc/keel) application.

```bash
npm create keeljs@latest my-app
```

## Presets

```bash
npm create keeljs@latest my-app                 # full-stack "app" (default)
npm create keeljs@latest my-api  -- --preset api
npm create keeljs@latest my-saas -- --preset saas
npm create keeljs@latest bare    -- --preset minimal
```

| Preset | Use when |
|--------|----------|
| `minimal` | Hello-world / learning — routes, a view, Tailwind. No database. |
| `api` | JSON API — `apiResource`, OpenAPI `/docs`, Watch, migrations, tests. |
| `app` *(default)* | Product with views, sessions, register/login, password reset, email verification, 2FA. |
| `saas` | Multi-tenant product — teams, roles, invitations, Stripe-ready team billing. |

Templates live inside `@shaferllc/keel`, so the kit version matches the framework
version you install. See [Starter kits](https://github.com/shaferllc/keel/blob/main/docs/starter-kits.md).

## Refreshing a kit

```bash
npm install @shaferllc/keel@latest
npx keel kit:sync              # or: keel kit:sync --preset saas --dry-run
```
