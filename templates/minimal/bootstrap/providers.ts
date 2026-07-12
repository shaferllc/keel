import type { ProviderClass } from "@shaferllc/keel/core";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";

/** Service providers loaded on every request and command, in order. */
export const providers: ProviderClass[] = [AppServiceProvider];
