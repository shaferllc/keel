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

  // Layout
  container: "keel-container",
  containerNarrow: "keel-container keel-container--narrow",
  containerWide: "keel-container keel-container--wide",
  bar: "keel-bar",
  stack: "keel-stack",
  stackTight: "keel-stack keel-stack--tight",
  stackLoose: "keel-stack keel-stack--loose",
  grid: "keel-grid",
  grid2: "keel-grid keel-grid--2",
  grid3: "keel-grid keel-grid--3",
  divider: "keel-divider",
  footer: "keel-footer",

  // Surfaces
  card: "keel-card",
  cardLink: "keel-card keel-card--link",
  cardFlush: "keel-card keel-card--flush",
  cardTitle: "keel-card-title",
  cardBody: "keel-card-body",
  badge: "keel-badge",
  badgeSea: "keel-badge keel-badge--sea",
  badgeBrass: "keel-badge keel-badge--brass",
  badgeDanger: "keel-badge keel-badge--danger",

  // Text and data
  code: "keel-code",
  pre: "keel-pre",
  table: "keel-table",
  tableFixed: "keel-table keel-table--fixed",
  prose: "keel-prose",

  // Theming
  themeToggle: "keel-theme-toggle",
} as const;

export type UiClassName = (typeof classes)[keyof typeof classes];
