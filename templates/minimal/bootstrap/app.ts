/**
 * Application bootstrap. Creates the container, boots providers, loads routes.
 * Both the server and the console enter through here.
 */

import { Application, Router, HttpKernel } from "@shaferllc/keel/core";

import { providers } from "./providers.js";
import { Kernel } from "../app/Http/Kernel.js";
import registerWebRoutes from "../routes/web.js";

export async function createApplication(): Promise<Application> {
  const app = new Application(process.cwd());

  // Binding our Kernel under HttpKernel is what makes `keel serve` use it. Without
  // this the console falls back to a bare HttpKernel and your global middleware
  // quietly vanishes.
  app.singleton(HttpKernel, (container) => new Kernel(container as Application));

  await app.boot(providers);
  registerWebRoutes(app.make(Router));

  return app;
}
