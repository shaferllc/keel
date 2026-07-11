// Type-check harness for docs/helpers.md. Every type-checkable snippet in the
// guide is exercised here against the real exports, so a renamed helper or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  app,
  config,
  view,
  bind,
  singleton,
  instance,
  make,
  bound,
  events,
  emit,
  listen,
  cache,
  logger,
  Config,
  type Listener,
  type Token,
  type Factory,
  type Renderable,
} from "@shaferllc/keel/core";

// Stand-ins for app-defined values referenced in the guide.
type User = { id: number };
class Mailer {
  constructor(_dep?: unknown) {}
}

declare const user: User;
declare const order: { id: number };
declare const code: string;
declare const orderId: number;
declare function computeStats(): Promise<{ total: number }>;
declare function sendWelcome(u: User): void;
declare function fulfil(id: number): void;
declare function Welcome(props: { appName: string }): Renderable;
declare function HomePage(): Renderable;

// --- Intro ---
export function intro() {
  const name = config<string>("app.name", "Keel");
  return name;
}

export async function introUsage() {
  const stats = await cache().remember("stats", 60, () => computeStats());
  await emit("user.registered", user);
  logger().info("welcome sent", { userId: user.id });
  return stats;
}

// --- Container helpers, up close ---
export function containerHelpers() {
  singleton(Mailer, (a) => new Mailer(a.make(Config)));
  const mailer = make(Mailer);
  if (bound("clock")) {
    /* someone registered it */
  }
  return mailer;
}

// --- Events, cache, logger ---
export async function servicesUpClose() {
  listen("order.paid", (o: { id: number }) => fulfil(o.id));
  await emit("order.paid", order);
  events().listenerCount("order.paid");

  await cache().put("otp", code, 300);
  logger().warn("retrying", { attempt: 2 });
}

// --- Rendering a view ---
function WelcomeInline({ appName }: { appName: string }): Renderable {
  return `<h1>Welcome to ${appName}</h1>`;
}

export async function rendering() {
  const a = await view(WelcomeInline, { appName: "Keel" });
  const b = await view(HomePage);
  return { a, b };
}

// --- API reference: app() ---
export function appHelper() {
  const port = app().config().get<number>("app.port", 3000);
  return port;
}

// --- config() ---
export function configHelper() {
  const a = config<string>("app.name");
  const b = config("app.port", 3000);
  return { a, b };
}

// --- view() ---
export async function viewHelper() {
  const a = await view(Welcome, { appName: "Keel" });
  const b = await view(HomePage);
  return { a, b };
}

// --- bind() ---
export function bindHelper() {
  bind("clock", () => new Date());
}

// --- singleton() ---
export function singletonHelper() {
  singleton(Mailer, (a) => new Mailer(a.make(Config)));
}

// --- instance() ---
export function instanceHelper() {
  const version = instance("app.version", "0.30.0");
  return version;
}

// --- make() ---
export function makeHelper() {
  const mailer = make(Mailer);
  const version = make<string>("app.version");
  return { mailer, version };
}

// --- bound() ---
export function boundHelper() {
  if (bound("clock")) return make<Date>("clock");
  return new Date();
}

// --- events() ---
export function eventsHelper() {
  events().listenerCount("order.paid");
  events().clear("order.paid");
}

// --- emit() ---
export async function emitHelper() {
  await emit("user.registered", user);
}

// --- listen() ---
export function listenHelper() {
  const off = listen("user.registered", (u: User) => sendWelcome(u));
  off();
}

// --- cache() ---
export async function cacheHelper() {
  const stats = await cache().remember("stats", 60, () => computeStats());
  await cache().put("otp", code, 300);
  return stats;
}

// --- logger() ---
export function loggerHelper() {
  logger().info("user registered", { userId: user.id });
  logger().error("payment failed", { orderId });
}

// --- Interfaces & types ---
const onOrder: Listener<{ id: number }> = async (o) => fulfil(o.id);
const strToken: Token<string> = "app.version";
const svcToken: Token<Mailer> = Mailer;
const mailerFactory: Factory<Mailer> = (a) => new Mailer(a.make(Config));
const renderable: Renderable = "<p>hi</p>";

export { onOrder, strToken, svcToken, mailerFactory, renderable };
