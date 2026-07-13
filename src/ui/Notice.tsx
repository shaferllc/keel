import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

type BoxProps = PropsWithChildren<{ class?: string }>;

/** Soft brass callout (e.g. verify email). */
export function Notice({ class: className, children }: BoxProps) {
  return <div class={cx(classes.notice, className)}>{children}</div>;
}

/** Danger / validation error box. */
export function Alert({ class: className, children }: BoxProps) {
  return <p class={cx(classes.alert, className)}>{children}</p>;
}
