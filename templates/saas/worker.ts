/**
 * The Cloudflare Workers entry. `wrangler dev` / `wrangler deploy` use this.
 *
 * D1's binding only exists inside a request, so the connection is wired here, before
 * the app boots — and the app is built once, then reused.
 *
 * Note the provider list: `edgeProviders`, not the Node one. See providers.edge.ts.
 */

import { setConnection, HttpKernel } from "@shaferllc/keel/core";
import { d1Connection, type D1Like } from "@shaferllc/keel/db/d1";

import { createApplication } from "./bootstrap/app.js";
import { edgeProviders } from "./bootstrap/providers.edge.js";

interface Env {
  DB: D1Like;
}

let handler: { fetch: (request: Request, env: unknown) => Response | Promise<Response> } | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!handler) {
      setConnection(d1Connection(env.DB), "sqlite");

      const app = await createApplication(edgeProviders);
      handler = app.make(HttpKernel).build();
    }

    return handler.fetch(request, env);
  },
};
