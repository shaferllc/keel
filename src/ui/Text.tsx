import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

type TextProps = PropsWithChildren<{ class?: string }>;

/** Inline code. */
export function Code({ class: className, children }: TextProps) {
  return <code class={cx(classes.code, className)}>{children}</code>;
}

/** Code block. Children are rendered verbatim — escape them yourself if needed. */
export function Pre({ class: className, children }: TextProps) {
  return <pre class={cx(classes.pre, className)}>{children}</pre>;
}

/**
 * Long-form copy. Styles plain `<h2>`, `<p>`, `<ul>`, `<pre>` and `<a>` inside,
 * so rendered Markdown needs no per-element classes.
 */
export function Prose({
  class: className,
  as: Tag = "div",
  children,
}: TextProps & { as?: "div" | "article" | "section" }) {
  return <Tag class={cx(classes.prose, className)}>{children}</Tag>;
}

/** Data table. Style comes from the wrapper — `<thead>`/`<tbody>` stay plain. */
export function Table({
  fixed,
  class: className,
  children,
}: TextProps & { fixed?: boolean }) {
  return <table class={cx(fixed ? classes.tableFixed : classes.table, className)}>{children}</table>;
}
