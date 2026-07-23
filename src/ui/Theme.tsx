import { raw } from "hono/html";
import { classes } from "./classes.js";
import { cx } from "./cx.js";

/** localStorage key holding the forced mode, if the visitor picked one. */
export const THEME_STORAGE_KEY = "keel-theme";

/**
 * The script is deliberately tiny and runs synchronously in <head>, before
 * first paint, so a visitor who chose dark never sees a light flash. It also
 * delegates clicks for any `[data-keel-theme-toggle]` element on the page.
 *
 * `swap()` suppresses transitions across the change. That is not only polish:
 * Chrome does not re-resolve a *transitioned* property when `color-scheme`
 * changes, so a button whose background is a `light-dark()` token stays painted
 * in the old mode until something else forces a recalc. Disabling transitions
 * for the swap forces that recalc — and stops every element on the page from
 * cross-fading at once, which is what you wanted anyway.
 */
const THEME_SCRIPT = `(function(){
var K=${JSON.stringify(THEME_STORAGE_KEY)},C="keel-theme-switching",d=document.documentElement;
function stored(){try{return localStorage.getItem(K)}catch(e){return null}}
function apply(m){if(m==="light"||m==="dark"){d.setAttribute("data-theme",m)}else{d.removeAttribute("data-theme")}}
function resolved(){var s=stored();if(s)return s;
return matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}
function swap(m){d.classList.add(C);apply(m);void d.offsetWidth;
requestAnimationFrame(function(){d.classList.remove(C)})}
apply(stored());
window.keelTheme={
get:resolved,
set:function(m){try{m?localStorage.setItem(K,m):localStorage.removeItem(K)}catch(e){}swap(m)},
clear:function(){window.keelTheme.set(null)},
toggle:function(){window.keelTheme.set(resolved()==="dark"?"light":"dark")}};
document.addEventListener("click",function(e){
var t=e.target.closest&&e.target.closest("[data-keel-theme-toggle]");
if(t){e.preventDefault();window.keelTheme.toggle()}});
// The OS flipping under us needs the same recalc, and no attribute changes.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){
if(!stored())swap(null)});
})();`;

/**
 * Drop into <head>, above the stylesheet. Without it the page still follows the
 * operating system — this only adds the remembered override and the toggle.
 *
 *   <head>
 *     <ThemeScript />
 *     <link rel="stylesheet" href="/assets/app.css" />
 *   </head>
 */
export function ThemeScript({ nonce }: { nonce?: string } = {}) {
  return raw(`<script${nonce ? ` nonce="${nonce}"` : ""}>${THEME_SCRIPT}</script>`);
}

/** The raw script body, for apps that assemble their own <script> tag. */
export function themeScriptSource(): string {
  return THEME_SCRIPT;
}

/**
 * Light/dark switch. Needs `<ThemeScript />` on the page; renders a plain
 * button otherwise, so it degrades to a no-op rather than an error.
 */
export function ThemeToggle({
  class: className,
  label = "Switch colour theme",
}: {
  class?: string;
  label?: string;
} = {}) {
  return (
    <button
      type="button"
      class={cx(classes.themeToggle, className)}
      data-keel-theme-toggle
      aria-label={label}
      title={label}
    >
      <span class="keel-theme-icon keel-theme-icon--to-dark" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </span>
      <span class="keel-theme-icon keel-theme-icon--to-light" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </span>
    </button>
  );
}
