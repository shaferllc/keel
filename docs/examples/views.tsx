// Type-check harness for docs/views.md. Every type-checkable snippet in the
// reference is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never
// executed. This file is .tsx so the JSX in the examples compiles (tsconfig
// already routes JSX through hono/jsx).
import { view, View, type Renderable, type ViewConfig } from "@shaferllc/keel/core";
import type { FC, PropsWithChildren } from "hono/jsx";

// A layout is just a component that wraps its children.
const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>{title}</title>
    </head>
    <body>{children}</body>
  </html>
);

const WelcomePage: FC<{ appName: string }> = ({ appName }) => (
  <Layout title={appName}>
    <h1>⚓ {appName}</h1>
    <p>Your view is rendering.</p>
  </Layout>
);

const HomePage: FC = () => <p>home</p>;

// An async component: data-fetching happens inside, render() awaits it.
declare function loadStats(userId: number): Promise<unknown>;
const Dashboard: FC<{ userId: number }> = async ({ userId }) => {
  const stats = await loadStats(userId);
  return <pre>{JSON.stringify(stats)}</pre>;
};

const Fragment: FC = () => <span>fragment</span>;

export async function helper() {
  const withProps = await view(WelcomePage, { appName: "Keel" });
  const noProps = await view(HomePage);
  const dash = await view(Dashboard, { userId: 1 });
  return { withProps, noProps, dash };
}

export async function service() {
  const html = await new View().render(WelcomePage({ appName: "Keel" }));
  const raw = await new View().render("<p>plain html</p>");
  const frag = await new View({ doctype: false }).render(Fragment({}));

  // null / undefined render just the doctype (or empty when doctype is off).
  const shell = await new View().render(null);
  const empty = await new View({ doctype: false }).render(undefined);

  return { html, raw, frag, shell, empty };
}

// Interface / type seams
const a: Renderable = "<h1>hi</h1>";
const b: Renderable = Promise.resolve("<h1>hi</h1>");
const c: Renderable = null;
const config: ViewConfig = { doctype: false };
export { a, b, c, config };
