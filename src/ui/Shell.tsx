import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

type BoxProps = PropsWithChildren<{ class?: string }>;

/** App content column. */
export function Shell({ class: className, children }: BoxProps) {
  return <main class={cx(classes.shell, className)}>{children}</main>;
}

/** Shell header row (brand + nav). */
export function ShellNav({ class: className, children }: BoxProps) {
  return <header class={cx(classes.shellNav, className)}>{children}</header>;
}

/** Horizontal nav links inside ShellNav. */
export function ShellLinks({ class: className, children }: BoxProps) {
  return <nav class={cx(classes.shellLinks, className)}>{children}</nav>;
}

/** Uppercase section eyebrow. */
export function SectionLabel({
  class: className,
  children,
  as: Tag = "p",
}: BoxProps & { as?: "p" | "h2" | "h3" | "span" }) {
  return <Tag class={cx(classes.sectionLabel, className)}>{children}</Tag>;
}

/** Soft secondary text. */
export function Muted({ class: className, children, as: Tag = "p" }: BoxProps & { as?: "p" | "span" | "div" }) {
  return <Tag class={cx(classes.muted, className)}>{children}</Tag>;
}

/** Inline form row (field + button). */
export function RowForm({ class: className, children }: BoxProps) {
  return <div class={cx(classes.rowForm, className)}>{children}</div>;
}
