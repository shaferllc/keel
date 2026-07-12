/**
 * The docs UI: a Swagger UI shell pointed at the generated spec. Swagger UI's
 * assets load from the configured `cdn` (pin it, or point it at a copy you host)
 * — the one external dependency in this package, kept to the UI. The spec itself
 * (`/openapi.json`) is generated with zero dependencies and works anywhere.
 */

import { escapeHtml } from "../core/template.js";
import type { OpenApiConfig } from "./config.js";

export function swaggerHtml(specUrl: string, cfg: OpenApiConfig): string {
  const cdn = cfg.cdn.replace(/\/+$/, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(cfg.title)} — API docs</title>
  <link rel="stylesheet" href="${cdn}/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${cdn}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: "#swagger-ui",
      deepLinking: true,
    });
  </script>
</body>
</html>`;
}
