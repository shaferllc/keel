import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

type BrandProps = PropsWithChildren<{
  class?: string;
  href?: string;
  as?: "span" | "h1" | "p" | "a";
}>;

/** Display-face brand wordmark. */
export function Brand({ class: className, href, as, children }: BrandProps) {
  const cls = cx(classes.brand, className);
  if (href != null || as === "a") {
    return (
      <a href={href ?? "/"} class={cls}>
        {children}
      </a>
    );
  }
  const Tag = as ?? "span";
  return <Tag class={cls}>{children}</Tag>;
}
