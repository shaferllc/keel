import type { PropsWithChildren } from "hono/jsx";
import { Brand, Panel, Rise, classes } from "@shaferllc/keel/ui";
import Layout from "../layout.js";

/** Shared chrome for auth screens — brand above a quiet panel. */
export function AuthShell({
  title,
  children,
  wide = false,
}: PropsWithChildren<{ title: string; wide?: boolean }>) {
  return (
    <Layout title={title}>
      <main class="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-16">
        <Brand href="/" class={`${classes.rise} mb-10 text-3xl text-ink`}>
          Keel
        </Brand>
        <Rise step={1}>
          <Panel variant={wide ? "auth-wide" : "auth"}>{children}</Panel>
        </Rise>
      </main>
    </Layout>
  );
}
