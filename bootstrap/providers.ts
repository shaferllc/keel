import type { ProviderClass } from "@keel/core";
import { WatchServiceProvider } from "@keel/watch";
import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { DatabaseServiceProvider } from "../app/Providers/DatabaseServiceProvider.js";

/** Service providers loaded on every request/command, in order. */
export const providers: ProviderClass[] = [
  AppServiceProvider,
  DatabaseServiceProvider,
  WatchServiceProvider,
];
