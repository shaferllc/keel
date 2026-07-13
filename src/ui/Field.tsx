import { classes } from "./classes.js";
import { cx } from "./cx.js";

/** Text input with kit field styling. Extra attrs pass through to `<input>`. */
export function Field(props: Record<string, unknown> & { class?: string; type?: string }) {
  const { class: className, type = "text", ...rest } = props;
  return <input class={cx(classes.field, className)} type={type} {...rest} />;
}
