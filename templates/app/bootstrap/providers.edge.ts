import type { ProviderClass } from "@shaferllc/keel/core";
import { AccountsServiceProvider } from "@shaferllc/keel/accounts";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";

/**
 * Providers for the Worker.
 *
 * `DatabaseServiceProvider` is deliberately absent, and that's not an optimization —
 * it's what keeps the build working. It reaches for `pg` and `@libsql/client`, which
 * need `net`/`tls`; if the Worker's import graph touched it, wrangler would try to
 * bundle a TCP driver for the edge and the deploy would fail. worker.ts binds D1
 * before boot, so nothing here needs to open a connection.
 */
export const edgeProviders: ProviderClass[] = [AccountsServiceProvider, AppServiceProvider];
