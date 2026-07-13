import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

/** Film-grain overlay for the page body. */
export function Grain({ class: className }: { class?: string }) {
  return <div class={cx(classes.grain, className)} aria-hidden="true" />;
}

type RiseProps = PropsWithChildren<{
  class?: string;
  /** Stagger step: 0 = none, 1–3 = delayed. */
  step?: 0 | 1 | 2 | 3;
  as?: "div" | "p" | "h1" | "h2" | "span" | "section";
}>;

const riseStep: Record<0 | 1 | 2 | 3, string> = {
  0: classes.rise,
  1: classes.rise1,
  2: classes.rise2,
  3: classes.rise3,
};

/** Entrance animation wrapper. */
export function Rise({ step = 0, class: className, as: Tag = "div", children }: RiseProps) {
  return <Tag class={cx(riseStep[step], className)}>{children}</Tag>;
}
