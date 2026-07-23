import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

type CardProps = PropsWithChildren<{
  class?: string;
  /** Pass `href` and the card renders an <a> that lifts on hover. */
  href?: string;
  /** Drop the padding — for cards that open with an image or table. */
  flush?: boolean;
}>;

/** Content card. The workhorse surface for grids and feature lists. */
export function Card({ href, flush, class: className, children }: CardProps) {
  const base = href != null ? classes.cardLink : flush ? classes.cardFlush : classes.card;
  const cls = cx(base, flush && href != null && "keel-card--flush", className);
  if (href != null) {
    return (
      <a href={href} class={cls}>
        {children}
      </a>
    );
  }
  return <div class={cls}>{children}</div>;
}

/** Card heading, in the display face. */
export function CardTitle({
  class: className,
  as: Tag = "h3",
  children,
}: PropsWithChildren<{ class?: string; as?: "h2" | "h3" | "h4" | "p" }>) {
  return <Tag class={cx(classes.cardTitle, className)}>{children}</Tag>;
}

/** Card body copy. */
export function CardBody({
  class: className,
  as: Tag = "p",
  children,
}: PropsWithChildren<{ class?: string; as?: "p" | "div" }>) {
  return <Tag class={cx(classes.cardBody, className)}>{children}</Tag>;
}
