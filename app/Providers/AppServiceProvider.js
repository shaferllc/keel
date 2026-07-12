import { ServiceProvider, bind, singleton, Inertia, inertiaPageAttr, Vite, viteTags, viteReactRefresh, } from "@keel/core";
/**
 * The primary application provider. Bind your services in register(),
 * wire them together in boot().
 */
export class AppServiceProvider extends ServiceProvider {
    register() {
        // Global helpers — no `this.app` needed.
        bind("clock", () => new Date().toISOString());
        // Vite — the frontend build. Tags resolve to the dev server (with HMR) when
        // `npm run dev:client` is running, or to hashed production assets otherwise.
        singleton(Vite, () => new Vite({ entrypoints: ["resources/js/app.ts"] }));
        // Configure Inertia with an HTML shell that loads the Vite bundle.
        singleton(Inertia, () => new Inertia({
            version: "1",
            rootView: (page) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Keel</title>` +
                `${viteReactRefresh()}${viteTags("resources/js/app.ts")}</head>` +
                `<body><div id="app" data-page="${inertiaPageAttr(page)}"></div></body></html>`,
        }));
    }
    async boot() {
        // Read the hot file / build manifest from disk once, at startup.
        await this.app.make(Vite).loadFromDisk();
    }
}
