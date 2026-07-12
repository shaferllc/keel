/**
 * The server-rendered shell for the single-page dashboard. It carries no data —
 * just a mount point, a bit of boot config, and the bundled JS/CSS built by Vite
 * (`npm run build:watch`). Everything else is the SPA talking to the JSON API.
 */

import { ENTRY_TYPES } from "./entry.js";

export interface ShellOptions {
  /** The dashboard's base path, e.g. "/watch". */
  base: string;
  /** Where the built assets are served, e.g. "/watch/assets". */
  assetsUrl: string;
}

export function dashboardHtml({ base, assetsUrl }: ShellOptions): string {
  const boot = JSON.stringify({ base, api: `${base}/api`, types: ENTRY_TYPES });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Keel Watch</title>
  <link rel="stylesheet" href="${assetsUrl}/watch.css" />
</head>
<body>
  <div id="app"></div>
  <script>window.__WATCH__ = ${boot};</script>
  <script type="module" src="${assetsUrl}/watch.js"></script>
</body>
</html>`;
}
