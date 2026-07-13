import type { PropsWithChildren } from "hono/jsx";
import { Grain, classes } from "@shaferllc/keel/ui";

export default function Layout({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="stylesheet" href="/assets/app.css" />
      </head>
      <body class={classes.body}>
        <Grain />
        {children}
      </body>
    </html>
  );
}
