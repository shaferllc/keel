import type { ProviderClass } from "@shaferllc/keel/core";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { DatabaseServiceProvider } from "../app/Providers/DatabaseServiceProvider.js";

/** Providers for the Node runtime (`keel serve`, the console, migrations). */
export const providers: ProviderClass[] = [DatabaseServiceProvider, AppServiceProvider];
