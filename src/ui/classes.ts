/**
 * Named class-string escapes for the kit.
 * Prefer the JSX components; use these when you need a raw class on your own element.
 */
export const classes = {
  body: "keel-body",
  grain: "keel-grain",
  brand: "keel-brand",
  rise: "keel-rise",
  rise1: "keel-rise keel-rise--1",
  rise2: "keel-rise keel-rise--2",
  rise3: "keel-rise keel-rise--3",
  btnPrimary: "keel-btn keel-btn--primary",
  btnGhost: "keel-btn keel-btn--ghost",
  btnSea: "keel-btn keel-btn--sea",
  field: "keel-field",
  panel: "keel-panel",
  authPanel: "keel-panel keel-panel--auth",
  authPanelWide: "keel-panel keel-panel--auth keel-panel--auth-wide",
  shell: "keel-shell",
  shellNav: "keel-shell-nav",
  shellLinks: "keel-shell-links",
  sectionLabel: "keel-section-label",
  notice: "keel-notice",
  alert: "keel-alert",
  hero: "keel-hero",
  heroGlow: "keel-hero-glow",
  heroInner: "keel-hero-inner",
  muted: "keel-muted",
  rowForm: "keel-row-form",
} as const;

export type UiClassName = (typeof classes)[keyof typeof classes];
