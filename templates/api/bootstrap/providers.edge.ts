import type { ProviderClass } from "@shaferllc/keel/core";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";

/**
 * Providers for the Worker.
 *
 * `DatabaseServiceProvider` is deliberately absent, and that's not an optimization —
 * it's what keeps the build working. It reaches for `pg` and `@libsql/client`, which
 * need `net`/`tls`; if the Worker's import graph touched it, wrangler would try to
 * bundle a TCP driver for the edge and fail. The D1 binding is wired in worker.ts
 * before boot, so nothing here needs to open a connection.
 */
export const edgeProviders: ProviderClass[] = [AppServiceProvider];
