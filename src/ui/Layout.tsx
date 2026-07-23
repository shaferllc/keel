import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

type BoxProps = PropsWithChildren<{ class?: string }>;

/**
 * Page-width wrapper — the marketing / docs column, wider than `Shell`.
 * `size="narrow"` for prose pages, `"wide"` for dashboards.
 */
export function Container({
  size = "default",
  class: className,
  as: Tag = "div",
  children,
}: BoxProps & {
  size?: "default" | "narrow" | "wide";
  as?: "div" | "main" | "section" | "header" | "footer";
}) {
  const base =
    size === "narrow"
      ? classes.containerNarrow
      : size === "wide"
        ? classes.containerWide
        : classes.container;
  return <Tag class={cx(base, className)}>{children}</Tag>;
}

/** Sticky top bar — brand on the left, links and actions on the right. */
export function Bar({ class: className, children }: BoxProps) {
  return <header class={cx(classes.bar, className)}>{children}</header>;
}

/** Vertical rhythm. */
export function Stack({
  gap = "default",
  class: className,
  as: Tag = "div",
  children,
}: BoxProps & { gap?: "tight" | "default" | "loose"; as?: "div" | "section" | "li" | "form" }) {
  const base =
    gap === "tight" ? classes.stackTight : gap === "loose" ? classes.stackLoose : classes.stack;
  return <Tag class={cx(base, className)}>{children}</Tag>;
}

/** Auto-fitting card grid. `cols` sets the minimum track width, not a hard count. */
export function Grid({
  cols = "default",
  class: className,
  children,
}: BoxProps & { cols?: "default" | 2 | 3 }) {
  const base = cols === 2 ? classes.grid2 : cols === 3 ? classes.grid3 : classes.grid;
  return <div class={cx(base, className)}>{children}</div>;
}

/** Fading horizontal rule. */
export function Divider({ class: className }: { class?: string }) {
  return <hr class={cx(classes.divider, className)} />;
}

/** Page footer band. */
export function Footer({ class: className, children }: BoxProps) {
  return <footer class={cx(classes.footer, className)}>{children}</footer>;
}
