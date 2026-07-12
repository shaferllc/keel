import type { PropsWithChildren } from "hono/jsx";

export default function Layout({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/assets/app.css" />
      </head>
      <body class="min-h-screen bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
