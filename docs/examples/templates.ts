// Type-check harness for docs/templates.md. Every type-checkable snippet is
// exercised here against the real exports, so a renamed method or wrong argument
// type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  templates,
  render,
  setTemplateEngine,
  escapeHtml,
  TemplateEngine,
  html,
  type Filter,
} from "@shaferllc/keel/core";

declare const user: { name: string; admin: boolean };
declare function readFile(path: string, enc: string): Promise<string>;

export async function rendering() {
  templates().register("greeting", "Hello, {{ name }}!");
  const out = await render("greeting", { name: "Ada" });
  return html(out);
}

export async function registerAll() {
  templates().registerAll({
    layout: await readFile("views/layout.html", "utf8"),
    home: await readFile("views/home.html", "utf8"),
  });
}

export function customFilter() {
  templates().filter("currency", (v, code) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: String(code) }).format(Number(v)),
  );
}

export function globals() {
  templates()
    .global("appName", "Keel")
    .global("asset", (path: string) => `/static/${path}`);
}

export function ownEngine() {
  const engine = new TemplateEngine();
  engine.register("home", "…");
  engine.registerAll({ a: "A", b: "B" });
  engine.has("home");
  engine.global("appName", "Keel");
  engine.filter("upper", (v) => String(v).toUpperCase());
  setTemplateEngine(engine);
  return engine.render("home", { user });
}

// Interfaces & types
const filter: Filter = (value, ...args) => `${String(value)}${args.length}`;

export function escaping() {
  return [escapeHtml("<b>&\"'</b>"), escapeHtml(null), escapeHtml(42), filter("x", 1)];
}
