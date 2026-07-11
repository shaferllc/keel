// Type-check harness for docs/container.md. Every type-checkable snippet in the
// guide is exercised here against the real exports, so a renamed method or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  Container,
  Application,
  ServiceProvider,
  bind,
  singleton,
  instance,
  make,
  bound,
  type Ctx,
  type Token,
  type Constructor,
  type Factory,
} from "@shaferllc/keel/core";

// Stand-ins for app-defined services referenced in the guide.
class Mailer {
  constructor(_dep?: unknown) {}
}
class ReportService {
  constructor(private app: Container) {}
}

declare const app: Container;

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.bind("clock", () => new Date());
    this.app.singleton(Mailer, (app) => new Mailer(app.make("config")));
    this.app.instance("version", "0.1.0");
  }
}

export function globalHelpers() {
  bind("clock", () => new Date());
  singleton(Mailer, (app) => new Mailer(app));
  instance("version", "0.6.0");

  const mailer = make(Mailer);
  const version = make<string>("version");
  if (bound("clock")) {
    /* … */
  }
  return { mailer, version };
}

export function resolving() {
  const mailer = make(Mailer);
  const version = make<string>("version");

  const report = app.make(ReportService); // no explicit binding

  make("nope"); // throws at runtime; type-checks fine
  const clock = bound("clock") ? make<Date>("clock") : new Date();
  return { mailer, version, report, clock };
}

export class InvoiceController {
  constructor(private app: Container) {}

  index(c: Ctx) {
    const config = this.app.make(Application).config();
    return c.json({ currency: config.get("app.currency", "USD") });
  }
}

export function containerReference() {
  app.bind("clock", () => new Date());
  app.bind(Mailer, (c) => new Mailer(c.make("config")));
  app.singleton(Mailer, (c) => new Mailer(c.make("config")));
  const version = app.instance("version", "0.30.0");

  const mailer = app.make(Mailer);
  const ver = app.make<string>("version");
  const same = app.get(Mailer);
  const report = app.build(ReportService);
  const isBound = app.bound("clock");

  return { version, mailer, ver, same, report, isBound };
}

export function helperReference() {
  bind("clock", () => new Date());
  singleton(Mailer, (app) => new Mailer(app));
  const version = instance("version", "0.30.0");
  const mailer = make(Mailer);
  const ver = make<string>("version");
  const isBound = bound("clock");
  return { version, mailer, ver, isBound };
}

// Type seams.
const nameKey: Token<string> = "app.name";
const svcKey: Token<Mailer> = Mailer;
const ctor: Constructor<ReportService> = ReportService;
const mailerFactory: Factory<Mailer> = (app) => new Mailer(app.make("config"));

export { nameKey, svcKey, ctor, mailerFactory };
