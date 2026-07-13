import type { PropsWithChildren } from "hono/jsx";
import Layout from "../layout.js";
import { authPanel, authPanelWide, brand, rise, rise1 } from "../ui.js";

/** Shared chrome for auth screens — brand above a quiet panel. */
export function AuthShell({
  title,
  children,
  wide = false,
}: PropsWithChildren<{ title: string; wide?: boolean }>) {
  return (
    <Layout title={title}>
      <main class="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-16">
        <a href="/" class={`${brand} ${rise} mb-10 text-3xl text-ink`}>
          Keel
        </a>
        <div class={`${wide ? authPanelWide : authPanel} ${rise1}`}>{children}</div>
      </main>
    </Layout>
  );
}
