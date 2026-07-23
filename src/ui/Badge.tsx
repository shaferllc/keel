import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

export type BadgeTone = "neutral" | "sea" | "brass" | "danger";

const toneClass: Record<BadgeTone, string> = {
  neutral: classes.badge,
  sea: classes.badgeSea,
  brass: classes.badgeBrass,
  danger: classes.badgeDanger,
};

/** Small status pill — version tags, plan names, row states. */
export function Badge({
  tone = "neutral",
  class: className,
  children,
}: PropsWithChildren<{ tone?: BadgeTone; class?: string }>) {
  return <span class={cx(toneClass[tone], className)}>{children}</span>;
}
