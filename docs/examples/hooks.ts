// Type-check harness for docs/hooks.md. Compile-only — never executed.
import {
  Application,
  Router,
  onReady,
  onShutdown,
  terminate,
  logger,
  redis,
  type LifecycleHook,
} from "@shaferllc/keel/core";

declare function warmCaches(): Promise<void>;

export function globalHooks() {
  onReady(async () => {
    await warmCaches();
    logger().info("app ready");
  });
  onShutdown(async () => {
    await redis().flushAll();
  });
}

export function signals() {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await terminate();
      process.exit(0);
    });
  }
}

export async function methodForm() {
  const app = new Application();
  app
    .onReady((a) => void a)
    .onShutdown(async () => {});
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const done: boolean = app.isTerminated;
  await app.terminate();
  return done;
}

export function routeHook(app: Application) {
  const router = app.make(Router);
  router.onRoute((def) => {
    logger().debug("route", { methods: def.methods, path: def.path, name: def.name });
  });
}

// The hook type
const ready: LifecycleHook = (app) => void app;
export { ready };
