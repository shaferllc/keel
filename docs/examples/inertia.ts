// Type-check harness for docs/inertia.md. Every type-checkable snippet in the
// reference is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import {
  ServiceProvider,
  singleton,
  Inertia,
  inertia,
  inertiaPageAttr,
  type InertiaPage,
  type InertiaOptions,
} from "@shaferllc/keel/core";

declare const user: { id: number; name: string };
declare const stats: unknown;
declare const notifications: unknown;
declare const activity: unknown;
declare const page: InertiaPage;
declare const rootView: (page: InertiaPage) => string;

// Configure it
export class InertiaServiceProvider extends ServiceProvider {
  register(): void {
    singleton(
      Inertia,
      () =>
        new Inertia({
          version: "1",
          rootView: (page) =>
            `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
            `<body><div id="app" data-page="${inertiaPageAttr(page)}"></div>` +
            `<script src="/assets/app.js"></script></body></html>`,
        }),
    );
  }
}

// Render a page
export function render() {
  const a: Response | string = inertia("Users/Show", { user });
  const b: Response | string = inertia("Dashboard");
  return { a, b };
}

// Partial reload example
export function partial() {
  return inertia("Dashboard", { stats, notifications, activity });
}

// Reference: inertiaPageAttr
export function attr() {
  return `<div id="app" data-page="${inertiaPageAttr(page)}"></div>`;
}

// Reference: Inertia class
export function classUsage() {
  const i = new Inertia({
    version: "1",
    rootView: (page) => `<div id="app" data-page="${inertiaPageAttr(page)}"></div>`,
  });
  const html: Response | string = i.render("Dashboard", { title: "Welcome" });
  const noProps: Response | string = i.render("Dashboard");
  return { html, noProps };
}

// Interface / type seams
const options: InertiaOptions = {
  version: "abc123",
  rootView: (page) => `<div id="app" data-page="${inertiaPageAttr(page)}"></div>`,
};

const pageSeam: InertiaPage = {
  component: "Users/Show",
  props: { user },
  url: "/users/1",
  version: "1",
};

const _rootView = rootView;

export { options, pageSeam, _rootView };
