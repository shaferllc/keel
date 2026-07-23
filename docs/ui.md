# UI

Keel ships a small design kit for server-rendered [views](./views.md): CSS
tokens, named component styles, and Hono JSX components. Starters import it from
`@shaferllc/keel/ui` — no second package.

```tsx
import { Button, Field, Panel } from "@shaferllc/keel/ui";
```

It is deliberately not a CSS framework. Tailwind stays underneath for
utilities; the kit is the house design language on top — tokens, a component
set, and light/dark.

## Stylesheet

Import the kit once in your app CSS, then Tailwind for app-authored utilities:

```css
/* resources/css/app.css */
@import "@shaferllc/keel/ui/css";
@import "tailwindcss";
```

Build with the Tailwind CLI (as the starters do) into `public/assets/app.css`,
and link that from your layout. The kit uses stable `.keel-*` classes so you do
**not** need to `@source` `node_modules` for Tailwind scanning.

## Tokens

The maritime default (Syne + IBM Plex, sea / ink / brass) lives in the kit CSS.
Override any token after the import:

```css
@import "@shaferllc/keel/ui/css";
@import "tailwindcss";

:root {
  --color-sea: #1a6b5c;
  --color-ink: #0a1218;
}
```

Tailwind v4 also sees the same values via `@theme`, so utilities like
`text-ink` and `bg-sea` work in your own markup.

| Token | Role |
|-------|------|
| `--color-ink` / `--color-ink-soft` | Body text, secondary text |
| `--color-mist` / `--color-foam` | Page background gradient |
| `--color-sea` / `--color-sea-deep` | Accent and its hover |
| `--color-brass` | Warm secondary accent |
| `--color-line` | Borders and rules |
| `--color-danger` / `--color-warn` | Alert and notice text |
| `--color-surface` / `--color-surface-strong` | Panel fill, raised fill |
| `--color-on-accent` | Text on a filled button |
| `--color-shadow` | Shadow tint |

## Light and dark

Every colour is declared once, as `light-dark(light, dark)`, so there is no
second stylesheet and no `dark:` variant to remember. Pages follow the operating
system by default.

To let visitors choose, add `ThemeScript` to `<head>` (above the stylesheet, so
the mode is set before first paint) and put `ThemeToggle` in your nav:

```tsx
import { ThemeScript, ThemeToggle } from "@shaferllc/keel/ui";

<head>
  <ThemeScript />
  <link rel="stylesheet" href="/assets/app.css" />
</head>;
```

The script stores the choice under `keel-theme` and sets `data-theme` on
`<html>`. It also exposes `window.keelTheme` — `get()`, `set("dark")`,
`toggle()`, `clear()` (back to following the OS) — and delegates clicks for any
`[data-keel-theme-toggle]` element, so your own button works too. Pass
`nonce="…"` if you run a strict CSP.

For one frame during the swap it puts `keel-theme-switching` on `<html>`, which
disables every transition. That is load-bearing, not decoration: Chrome does not
re-resolve a *transitioned* property when `color-scheme` changes, so a button
whose background is a `light-dark()` token would stay painted in the mode you
just left. If you switch themes without this script, do the same thing — or
your own transitioned colours will go stale.

Overriding a token means supplying both modes:

```css
:root {
  --color-sea: light-dark(#1a6b5c, #4fc0ae);
}
```

## Fonts

The kit never fetches a webfont — a framework has no business adding a
third-party request to every page. Without fonts installed it falls back to the
system UI stack, and looks fine.

To use the maritime default (Syne + IBM Plex Sans, OFL, latin + latin-ext
subsets), copy them into your app and import the `@font-face` sheet:

```bash
keel ui:fonts            # → public/fonts/*.woff2
```

```css
@import "@shaferllc/keel/ui/fonts";
@import "@shaferllc/keel/ui/css";
@import "tailwindcss";
```

The sheet points at `/fonts/*`, which is where `ui:fonts` writes. `--dir`
puts them somewhere else, in which case write your own `@font-face`.

## Components

| Component | Role |
|-----------|------|
| `Button` | `primary` / `ghost` / `sea`. Pass `href` to render an `<a>`. |
| `Field` | Styled text input; extra attrs pass through. |
| `Panel` | Surface. `variant="auth"` / `"auth-wide"` for auth cards. |
| `Card` / `CardTitle` / `CardBody` | Content card. Pass `href` and it lifts on hover. |
| `Badge` | Status pill — `neutral` / `sea` / `brass` / `danger`. |
| `Notice` / `Alert` | Soft callout / danger box. |
| `Brand` | Display-face wordmark. |
| `Container` / `Bar` | Page-width column (`narrow` / `wide`); sticky top bar. |
| `Stack` / `Grid` / `Divider` / `Footer` | Vertical rhythm, auto-fit card grid, rule, footer band. |
| `Shell` / `ShellNav` / `ShellLinks` | App chrome column + header nav. |
| `SectionLabel` / `Muted` / `RowForm` | Eyebrow, secondary text, inline form row. |
| `Hero` / `HeroGlow` / `HeroInner` | Full-viewport welcome stage. |
| `Code` / `Pre` / `Table` | Inline code, code block, data table. |
| `Prose` | Long-form copy — styles unclassed `<h2>`, `<p>`, `<ul>`, `<pre>`, `<a>`. |
| `Grain` / `Rise` | Body grain overlay; staggered entrance. |
| `ThemeScript` / `ThemeToggle` | Remembered light/dark and its switch. |

`Container` is the marketing and docs width; `Shell` is the narrower app column.
`Prose` is what rendered Markdown goes into.

```tsx
import { Button, Field, Panel, Alert } from "@shaferllc/keel/ui";

export default function Login({ error }: { error: string | null }) {
  return (
    <Panel variant="auth">
      {error && <Alert class="mt-5">{error}</Alert>}
      <form method="post" action="/login" class="mt-6 flex flex-col gap-3">
        <Field type="email" name="email" placeholder="Email" required />
        <Field type="password" name="password" placeholder="Password" required />
        <Button type="submit">Log in</Button>
      </form>
    </Panel>
  );
}
```

Compose with your own layout — the kit does not own `<html>` or the CSS link.
Starters keep `resources/views/layout.tsx` for that.

## The specimen page

`SpecimenPage` renders every token and every `.keel-*` class on one screen. It
is how you check a token change in both modes without hunting through an app.

```bash
npm run build:specimen && open public/specimen.html   # in the Keel repo
```

Mount it in your own app to see *your* overrides:

```ts
Route.get("/_ui", () => SpecimenPage({ stylesheet: "/assets/app.css" }));
```

## Escape hatches

Prefer components. When you need a raw class on your own element:

```ts
import { classes, cx } from "@shaferllc/keel/ui";

<a class={cx(classes.btnPrimary, "mt-4")} href="/register">
  Get started
</a>
```

`classes` mirrors every kit selector (`btnPrimary`, `field`, `shell`, `card`, …).

## What stays yours

- Document shell (`layout.tsx`) and asset URL
- Route-specific copy and forms
- Auth page composition (`AuthShell` in the starters)
- Extra Tailwind utilities for spacing, type scale, and one-off layout
