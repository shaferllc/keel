/**
 * Shared Tailwind class strings for the starter kit UI.
 * Keep each string complete and unbroken so Tailwind's scanner can see it.
 * Tokens live in resources/css/app.css (@theme).
 */

export const body =
  "relative min-h-screen overflow-x-hidden bg-[radial-gradient(1200px_600px_at_12%_-10%,color-mix(in_oklab,var(--color-sea)_18%,transparent),transparent_60%),radial-gradient(900px_500px_at_100%_0%,color-mix(in_oklab,var(--color-brass)_12%,transparent),transparent_55%),linear-gradient(180deg,var(--color-mist)_0%,var(--color-foam)_42%,#e8efec_100%)] font-sans text-ink antialiased selection:bg-sea/30";

export const grain =
  "pointer-events-none fixed inset-0 z-50 bg-[url('data:image/svg+xml,%3Csvg_viewBox=%270_0_200_200%27_xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter_id=%27n%27%3E%3CfeTurbulence_type=%27fractalNoise%27_baseFrequency=%270.85%27_numOctaves=%274%27_stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect_width=%27100%25%27_height=%27100%25%27_filter=%27url(%23n)%27/%3E%3C/svg%3E')] opacity-[0.035]";

export const brand = "font-display font-extrabold leading-[0.95] tracking-[-0.04em]";

export const rise = "animate-rise";
export const rise1 = "animate-rise [animation-delay:80ms]";
export const rise2 = "animate-rise [animation-delay:160ms]";
export const rise3 = "animate-rise [animation-delay:240ms]";

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[0.925rem] font-medium transition active:translate-y-px bg-ink text-white hover:bg-sea-deep";

export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[0.925rem] font-medium transition active:translate-y-px border border-line bg-white/70 text-ink backdrop-blur-sm hover:border-sea/40 hover:bg-white";

export const btnSea =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[0.925rem] font-medium transition active:translate-y-px bg-sea text-white hover:bg-sea-deep";

export const field =
  "field w-full rounded-xl border border-line bg-white/90 px-3.5 py-2.5 text-[0.95rem] outline-none transition focus:border-sea focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sea)_18%,transparent)]";

export const authPanel =
  "w-full max-w-sm rounded-2xl border border-line/80 bg-white/80 p-8 shadow-[0_24px_60px_-40px_color-mix(in_oklab,var(--color-ink)_45%,transparent)] backdrop-blur-md";

export const authPanelWide =
  "w-full max-w-lg rounded-2xl border border-line/80 bg-white/80 p-8 shadow-[0_24px_60px_-40px_color-mix(in_oklab,var(--color-ink)_45%,transparent)] backdrop-blur-md";

export const shell = "mx-auto max-w-2xl px-6 pb-16 pt-10";
export const shellNav = "mb-10 flex flex-wrap items-center justify-between gap-4";
export const shellLinks =
  "flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft [&_a]:underline-offset-[3px] [&_a:hover]:text-sea [&_a:hover]:underline";

export const panel = "rounded-2xl border border-line bg-white/80 px-5 py-4";
export const sectionLabel =
  "text-[0.72rem] font-semibold tracking-[0.14em] text-ink-soft/80 uppercase";

export const notice =
  "rounded-xl border border-brass/35 bg-[color-mix(in_oklab,var(--color-brass)_10%,white)] px-4 py-3 text-[0.9rem] text-warn";

export const alert =
  "rounded-xl border border-danger/25 bg-[color-mix(in_oklab,var(--color-danger)_8%,white)] px-3.5 py-3 text-sm text-danger";

export const hero =
  "relative flex min-h-screen flex-col justify-end overflow-hidden px-6 pt-8 pb-16";

export const heroGlow =
  "pointer-events-none absolute inset-x-[-20%] bottom-[-30%] h-[55%] bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--color-sea)_22%,transparent),transparent_70%),linear-gradient(180deg,transparent,color-mix(in_oklab,var(--color-ink)_6%,transparent))]";

export const heroInner = "relative z-10 w-full max-w-xl";
export const muted = "text-ink-soft";
export const rowForm = "mt-3 flex flex-wrap gap-2 [&_.field]:min-w-48 [&_.field]:flex-1";
