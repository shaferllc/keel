import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

type BoxProps = PropsWithChildren<{ class?: string }>;

/** Full-viewport hero stage. */
export function Hero({ class: className, children }: BoxProps) {
  return <main class={cx(classes.hero, className)}>{children}</main>;
}

/** Decorative glow behind hero content. */
export function HeroGlow({ class: className }: { class?: string }) {
  return <div class={cx(classes.heroGlow, className)} aria-hidden="true" />;
}

/** Constrained hero content column. */
export function HeroInner({ class: className, children }: BoxProps) {
  return <div class={cx(classes.heroInner, className)}>{children}</div>;
}
