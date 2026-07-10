import { ServiceProvider, bind, singleton, Inertia, inertiaPageAttr } from "@keel/core";

/**
 * The primary application provider. Bind your services in register(),
 * wire them together in boot().
 */
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Global helpers — no `this.app` needed.
    bind("clock", () => new Date().toISOString());

    // Configure Inertia with an HTML shell that embeds the page + client bundle.
    singleton(
      Inertia,
      () =>
        new Inertia({
          version: "1",
          rootView: (page) =>
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Keel</title></head>` +
            `<body><div id="app" data-page="${inertiaPageAttr(page)}"></div>` +
            `<script src="/assets/app.js"></script></body></html>`,
        }),
    );
  }

  boot(): void {
    // Runs after all providers have registered.
  }
}
