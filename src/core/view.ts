/**
 * The view layer. Keel views are components (Hono JSX elements or any object
 * with a toString()) that render to an HTML string.
 *
 * This is intentionally platform-neutral — no filesystem, no Node built-ins —
 * so the same views run under Node and on Cloudflare Workers. Components live
 * by convention in resources/views/.
 */

/**
 * Anything renderable to HTML: a raw string, a JSX node (whose toString()
 * yields HTML), a promise of either, or nullish (renders empty). This matches
 * the return type of Hono JSX function components.
 */
export type Renderable =
  | string
  | Promise<string>
  | { toString(): string | Promise<string> }
  | null
  | undefined;

export interface ViewConfig {
  /** Prepend an HTML5 doctype to rendered documents. Default: true. */
  doctype?: boolean;
}

export class View {
  constructor(private config: ViewConfig = {}) {}

  /**
   * Render a component to a complete HTML string. Handles both synchronous
   * and async (Suspense) JSX trees.
   */
  async render(content: Renderable): Promise<string> {
    const doctype = this.config.doctype === false ? "" : "<!DOCTYPE html>\n";
    if (content == null) return doctype;
    // `await` resolves promises and passes strings/JSX nodes through; String()
    // then collapses a JSX node to its rendered HTML.
    const resolved = await content;
    return doctype + String(resolved);
  }
}
