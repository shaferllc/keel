// Type-check harness for docs/sessions.md. Every type-checkable snippet in the
// reference is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import {
  HttpKernel,
  Application,
  session,
  sessionMiddleware,
  Session,
  redirect,
  type SessionOptions,
} from "@shaferllc/keel/core";

declare const user: { id: number };

export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(sessionMiddleware());
    this.use(sessionMiddleware({ cookieName: "sid", cookie: { secure: true } }));
  }
}

export function useIt() {
  session().put("userId", user.id);
  const id = session().get("userId");
  const id2 = session().get("userId", null);

  session().has("userId");
  session().forget("userId");
  session().pull("cart");
  session().increment("visits");
  session().clear();
  session().all();

  return { id, id2 };
}

export function sharedData() {
  session().put("step", 1);
  return session().get("step");
}

export function flashMessages() {
  session().flash("status", "Profile saved!");
  const r = redirect("/profile");

  const status = session().flashed("status");
  return { r, status };
}

export function flashCompartments() {
  session().flash("status", "Saved!");
  const a = session().flashed("status");
  const b = session().get("status");
  return { a, b };
}

export function counters() {
  session().increment("visits");
  session().increment("credits", 10);
  session().decrement("credits", 3);
}

// --- API reference ---

export function sessionRef() {
  session().put("userId", 1);
}

export function middlewareRef() {
  return sessionMiddleware({ cookieName: "sid", cookie: { secure: true } });
}

export function sessionMethods() {
  const s: Session = session();

  const data = s.all();
  const id = s.get<number>("userId");
  const theme = s.get("theme", "light");
  s.put("userId", 1).put("theme", "dark");
  s.set("locale", "en");
  const logged = s.has("userId");
  s.forget("userId");
  const cart = s.pull("cart", []);
  s.increment("visits");
  s.increment("credits", 25);
  s.decrement("credits", 3);
  s.clear();
  s.flash("status", "Profile saved!");
  const status = s.flashed("status");
  const msg = s.flashed("msg", "");

  return { data, id, theme, logged, cart, status, msg };
}

// Interface / type seams
const opts: SessionOptions = {
  cookieName: "sid",
  cookie: { secure: true, maxAge: 60 * 60 * 24 },
};
export { opts };
