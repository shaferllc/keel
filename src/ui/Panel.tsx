import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

type PanelProps = PropsWithChildren<{
  class?: string;
  /** Auth card sizing — default panel, or auth / auth-wide. */
  variant?: "default" | "auth" | "auth-wide";
  as?: "div" | "section" | "li";
}>;

/** Bordered surface panel. */
export function Panel({
  variant = "default",
  class: className,
  as: Tag = "div",
  children,
}: PanelProps) {
  const base =
    variant === "auth"
      ? classes.authPanel
      : variant === "auth-wide"
        ? classes.authPanelWide
        : classes.panel;
  return <Tag class={cx(base, className)}>{children}</Tag>;
}
