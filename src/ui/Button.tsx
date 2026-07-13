import type { PropsWithChildren } from "hono/jsx";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

export type ButtonVariant = "primary" | "ghost" | "sea";

const variantClass: Record<ButtonVariant, string> = {
  primary: classes.btnPrimary,
  ghost: classes.btnGhost,
  sea: classes.btnSea,
};

type ButtonProps = PropsWithChildren<{
  variant?: ButtonVariant;
  class?: string;
  type?: "button" | "submit" | "reset";
  href?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  form?: string;
}>;

/** Button or link styled with the kit. Pass `href` to render an `<a>`. */
export function Button({
  variant = "primary",
  class: className,
  href,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const cls = cx(variantClass[variant], className);
  if (href != null) {
    return (
      <a href={href} class={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} class={cls} {...rest}>
      {children}
    </button>
  );
}
