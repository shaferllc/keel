// @jsxRuntime automatic
// @jsxImportSource hono/jsx
import type { FC, PropsWithChildren } from "hono/jsx";

/** The base HTML document. Compose pages inside it. */
export const Layout: FC<PropsWithChildren<{ title: string }>> = ({
  title,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <style>{`
        body { font-family: system-ui, sans-serif; margin: 0; background: #0b1120; color: #e2e8f0; }
        main { max-width: 44rem; margin: 0 auto; padding: 4rem 1.5rem; }
        h1 { font-size: 2.25rem; margin: 0 0 .5rem; }
        code { background: #1e293b; padding: .15rem .4rem; border-radius: .3rem; }
      `}</style>
    </head>
    <body>
      <main>{children}</main>
    </body>
  </html>
);
