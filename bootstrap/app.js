/**
 * Application bootstrap. Creates the container, boots providers, registers the
 * HTTP kernel, and loads the route files. Both the server and the console
 * enter through here.
 */
import { Application, HttpKernel, Router } from "@keel/core";
import { providers } from "./providers.js";
import { Kernel } from "../app/Http/Kernel.js";
import registerWebRoutes from "../routes/web.js";
export async function createApplication() {
    const app = new Application(process.cwd());
    await app.boot(providers);
    // Bind the application's HTTP kernel (used by `keel serve`).
    app.singleton(HttpKernel, (a) => new Kernel(a));
    // Load route definitions onto the router.
    registerWebRoutes(app.make(Router));
    return app;
}
