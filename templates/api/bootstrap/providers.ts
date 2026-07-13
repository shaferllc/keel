import type { ProviderClass } from "@shaferllc/keel/core";
import { ApiServiceProvider } from "@shaferllc/keel/api";
import { OpenApiServiceProvider } from "@shaferllc/keel/openapi";
import { WatchServiceProvider } from "@shaferllc/keel/watch";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { DatabaseServiceProvider } from "../app/Providers/DatabaseServiceProvider.js";

/** Providers for the Node runtime (`keel serve`, the console, migrations). */
export const providers: ProviderClass[] = [
  DatabaseServiceProvider,
  ApiServiceProvider,
  OpenApiServiceProvider,
  WatchServiceProvider,
  AppServiceProvider,
];
