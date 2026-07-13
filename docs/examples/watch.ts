// Type-check harness for docs/watch.md. Compile-only — never executed.
import { Application } from "@shaferllc/keel/core";
import { WatchServiceProvider, Watch } from "@shaferllc/keel/watch";

export function install() {
  const app = new Application();
  app.register(WatchServiceProvider);
  Watch.auth((c) => c.req.header("x-watch-key") === "secret");
  return app;
}
