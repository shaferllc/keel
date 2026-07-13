# UI

Keel ships a small design kit for server-rendered [views](./views.md): CSS
tokens, named component styles, and Hono JSX components. Starters import it from
`@shaferllc/keel/ui` — no second package.

```tsx
import { Button, Field, Panel } from "@shaferllc/keel/ui";
```

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

## Components

| Component | Role |
|-----------|------|
| `Button` | `primary` / `ghost` / `sea`. Pass `href` to render an `<a>`. |
| `Field` | Styled text input; extra attrs pass through. |
| `Panel` | Surface. `variant="auth"` / `"auth-wide"` for auth cards. |
| `Notice` / `Alert` | Soft callout / danger box. |
| `Brand` | Display-face wordmark. |
| `Shell` / `ShellNav` / `ShellLinks` | App chrome column + header nav. |
| `SectionLabel` / `Muted` / `RowForm` | Eyebrow, secondary text, inline form row. |
| `Hero` / `HeroGlow` / `HeroInner` | Full-viewport welcome stage. |
| `Grain` / `Rise` | Body grain overlay; staggered entrance. |

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

## Escape hatches

Prefer components. When you need a raw class on your own element:

```ts
import { classes, cx } from "@shaferllc/keel/ui";

<a class={cx(classes.btnPrimary, "mt-4")} href="/register">
  Get started
</a>
```

`classes` mirrors every kit selector (`btnPrimary`, `field`, `shell`, …).

## What stays yours

- Document shell (`layout.tsx`) and asset URL
- Route-specific copy and forms
- Auth page composition (`AuthShell` in the starters)
- Extra Tailwind utilities for spacing, type scale, and one-off layout
