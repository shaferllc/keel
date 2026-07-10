import type { ProviderClass } from "@keel/core";
import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";

/** Service providers loaded on every request/command, in order. */
export const providers: ProviderClass[] = [
  AppServiceProvider,
];
