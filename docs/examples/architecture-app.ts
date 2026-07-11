// Type-check harness for the "application object" section of docs/architecture.md.
// Compile-only — never executed.
import { Application, type Configurator } from "@shaferllc/keel/core";

declare function sendWelcome(user: { id: number }): void;
declare function installBilling(app: Application): void;

export function configureApp(app: Application): Application {
  const cfg: Configurator = (a) => a.set("mail.from", "hi@keel.dev");
  return app.configure(cfg).configure(installBilling);
}

export function settings(app: Application) {
  app.set("db.url", "sqlite://x");
  const url: unknown = app.get("db.url");
  const name: string = app.get<string>("app.name", "Keel"); // typed fallback
  return { url, name };
}

export async function events(app: Application) {
  const off = app.on<{ id: number }>("user.registered", (user) => sendWelcome(user));
  const offOnce = app.once("tick", () => {});
  await app.emit("user.registered", { id: 1 });
  off();
  offOnce();
  app.off("user.registered", () => {});
}
