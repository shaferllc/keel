/**
 * Inertia.js server adapter. Pair Keel's server-side routing with an Inertia
 * client (React/Vue/Svelte) — `inertia("Page", props)` returns the right thing
 * automatically: a full HTML document on the first visit, or the Inertia JSON
 * page object on subsequent XHR navigations.
 *
 * Implements the Inertia protocol: the X-Inertia header, asset versioning
 * (409 + X-Inertia-Location on mismatch), and partial reloads.
 */

import { ctx } from "./request.js";
import { bound, make } from "./helpers.js";

export interface InertiaPage {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string;
}

export interface InertiaOptions {
  /** Asset version; a mismatch forces the client to hard-reload (409). */
  version?: string;
  /** Renders the HTML document shell for a first (non-XHR) load. */
  rootView: (page: InertiaPage) => string;
}

export class Inertia {
  private version: string;
  private rootView: (page: InertiaPage) => string;

  constructor(options: InertiaOptions) {
    this.version = options.version ?? "1";
    this.rootView = options.rootView;
  }

  render(component: string, props: Record<string, unknown> = {}): Response | string {
    const c = ctx();
    const requestUrl = new URL(c.req.url);
    const url = requestUrl.pathname + requestUrl.search;
    const isInertia = c.req.header("X-Inertia") === "true";

    // Asset version changed → tell the client to do a full reload.
    if (
      isInertia &&
      c.req.method === "GET" &&
      (c.req.header("X-Inertia-Version") ?? "") !== this.version
    ) {
      return new Response(null, { status: 409, headers: { "X-Inertia-Location": url } });
    }

    // Partial reload: send only the requested props for the matching component.
    let finalProps = props;
    const partialComponent = c.req.header("X-Inertia-Partial-Component");
    const partialData = c.req.header("X-Inertia-Partial-Data");
    if (isInertia && partialComponent === component && partialData) {
      const only = new Set(partialData.split(",").map((s) => s.trim()));
      finalProps = Object.fromEntries(
        Object.entries(props).filter(([k]) => only.has(k)),
      );
    }

    const page: InertiaPage = { component, props: finalProps, url, version: this.version };

    if (isInertia) {
      return c.json(page as never, 200, {
        "X-Inertia": "true",
        Vary: "X-Inertia",
      } as never);
    }

    // First load — the full HTML document with the page data embedded.
    return this.rootView(page);
  }
}

/**
 * Render an Inertia response for the current request. Requires an `Inertia`
 * instance bound in the container (configure it in a service provider).
 */
export function inertia(
  component: string,
  props: Record<string, unknown> = {},
): Response | string {
  if (!bound(Inertia)) {
    throw new Error(
      "Inertia is not configured. Bind it in a provider: " +
        "singleton(Inertia, () => new Inertia({ version, rootView })).",
    );
  }
  return make(Inertia).render(component, props);
}

/** HTML-escape a value for the `data-page` attribute of the root element. */
export function inertiaPageAttr(page: InertiaPage): string {
  return JSON.stringify(page)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
