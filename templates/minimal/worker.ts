/**
 * The Cloudflare Workers entry. `wrangler dev` / `wrangler deploy` use this;
 * `keel serve` (Node) does not.
 *
 * The app is built once and reused across requests.
 */

import { HttpKernel } from "@shaferllc/keel/core";

import { createApplication } from "./bootstrap/app.js";

let handler: { fetch: (request: Request, env: unknown) => Response | Promise<Response> } | undefined;

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    if (!handler) {
      const app = await createApplication();
      handler = app.make(HttpKernel).build();
    }

    return handler.fetch(request, env);
  },
};
