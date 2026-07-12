/**
 * Internationalization — translations with ICU message formatting, and the
 * `Intl` formatters that go with them.
 *
 *   setTranslations({
 *     en: { "cart.items": "{count, plural, =0 {Your cart is empty} one {# item} other {# items}}" },
 *     fr: { "cart.items": "{count, plural, =0 {Panier vide} one {# article} other {# articles}}" },
 *   });
 *
 *   t("cart.items", { count: 3 });              // "3 items" (the request's locale)
 *   i18n("fr").t("cart.items", { count: 3 });   // "3 articles"
 *
 * There is **no dependency** here, and there doesn't need to be: `Intl` ships with
 * every modern runtime — Node and Workers both carry the full ICU data — so
 * plurals, currencies, dates, and relative times are the platform's job. What Keel
 * adds is the message parser on top, which is the part `Intl` doesn't do.
 *
 * The supported ICU subset is the part people actually use: interpolation,
 * `plural`, `selectordinal`, `select`, `number`, `date`, and `time` — nested
 * arbitrarily deep. See the i18n guide for the grammar.
 */

import type { MiddlewareHandler } from "hono";
import { getContext } from "hono/context-storage";

import { hasApplication, emit } from "./helpers.js";

/* ------------------------------- translations ----------------------------- */

/** A locale's messages — nested objects or flat dot-separated keys, or both. */
export type Translations = Record<string, unknown>;

/** Messages keyed by locale: `{ en: {...}, fr: {...} }`. */
export type TranslationsByLocale = Record<string, Translations>;

/** Where translations come from. Return them; Keel flattens and indexes them. */
export interface TranslationLoader {
  load(): Promise<TranslationsByLocale> | TranslationsByLocale;
}

/**
 * Flatten nested translations to dot paths, so `{ cart: { items: "…" } }` and
 * `{ "cart.items": "…" }` are the same thing and can be mixed freely.
 */
function flatten(input: Translations, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value as Translations, path, out);
    } else if (value != null) {
      out[path] = String(value);
    }
  }
  return out;
}

/* ---------------------------- the ICU formatter --------------------------- */

/**
 * Find the index of the `}` matching the `{` at `open`. Brace-counting, because a
 * plural branch contains whole sub-messages that have braces of their own.
 */
function matchBrace(message: string, open: number): number {
  let depth = 0;
  for (let i = open; i < message.length; i++) {
    const char = message[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`i18n: unbalanced braces in message: ${message}`);
}

/** Split `one {# item} other {# items}` into its branches. */
function parseBranches(style: string): Record<string, string> {
  const branches: Record<string, string> = {};
  let i = 0;

  while (i < style.length) {
    // The branch key: everything up to the next `{`.
    while (i < style.length && /\s/.test(style[i]!)) i++;
    const open = style.indexOf("{", i);
    if (open === -1) break;

    const key = style.slice(i, open).trim();
    const close = matchBrace(style, open);
    if (key) branches[key] = style.slice(open + 1, close);
    i = close + 1;
  }

  return branches;
}

/** Split an argument's innards into `name`, `type`, and the raw `style`. */
function parseArg(inner: string): { name: string; type?: string; style?: string } {
  const firstComma = inner.indexOf(",");
  if (firstComma === -1) return { name: inner.trim() };

  const name = inner.slice(0, firstComma).trim();
  const rest = inner.slice(firstComma + 1);

  const secondComma = rest.indexOf(",");
  if (secondComma === -1) return { name, type: rest.trim() };

  return {
    name,
    type: rest.slice(0, secondComma).trim(),
    style: rest.slice(secondComma + 1).trim(),
  };
}

function numberFormat(locale: string, style?: string): Intl.NumberFormatOptions {
  if (!style) return {};
  if (style === "percent") return { style: "percent" };
  if (style === "integer") return { maximumFractionDigits: 0 };

  // The ICU skeleton for currency: `::currency/USD`.
  const currency = /^::currency\/([A-Z]{3})$/.exec(style);
  if (currency) return { style: "currency", currency: currency[1]! };

  return {};
}

type DateStyle = "full" | "long" | "medium" | "short";
const DATE_STYLES = new Set(["full", "long", "medium", "short"]);

function dateStyleOf(style: string | undefined, key: "dateStyle" | "timeStyle"): Intl.DateTimeFormatOptions {
  const value = style && DATE_STYLES.has(style) ? (style as DateStyle) : "medium";
  return { [key]: value };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") return new Date(value);
  throw new Error(`i18n: expected a date, got ${typeof value}`);
}

/**
 * Format an ICU message. The grammar we support:
 *
 *   {name}                                  interpolation
 *   {n, number}  {n, number, percent}  {n, number, ::currency/USD}
 *   {d, date, medium}   {d, time, short}
 *   {c, plural, =0 {none} one {# item} other {# items}}
 *   {c, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}
 *   {g, select, male {He} female {She} other {They}}
 *
 * `#` inside a plural branch becomes the formatted number. Branches are
 * themselves messages, so they nest. `'{'` and `'}'` are literal braces.
 */
export function formatMessage(
  message: string,
  data: Record<string, unknown> = {},
  locale = "en",
): string {
  let out = "";
  let i = 0;

  while (i < message.length) {
    const char = message[i]!;

    // ICU escaping: '{' and '}' are literal braces.
    if (char === "'" && (message[i + 1] === "{" || message[i + 1] === "}")) {
      const end = message.indexOf("'", i + 1);
      if (end === -1) {
        out += message.slice(i + 1);
        break;
      }
      out += message.slice(i + 1, end);
      i = end + 1;
      continue;
    }

    if (char !== "{") {
      out += char;
      i++;
      continue;
    }

    const close = matchBrace(message, i);
    const { name, type, style } = parseArg(message.slice(i + 1, close));
    const value = data[name];
    i = close + 1;

    if (!type) {
      out += value == null ? "" : String(value);
      continue;
    }

    switch (type) {
      case "number":
        out += new Intl.NumberFormat(locale, numberFormat(locale, style)).format(Number(value));
        break;

      case "date":
        out += new Intl.DateTimeFormat(locale, dateStyleOf(style, "dateStyle")).format(toDate(value));
        break;

      case "time":
        out += new Intl.DateTimeFormat(locale, dateStyleOf(style, "timeStyle")).format(toDate(value));
        break;

      case "plural":
      case "selectordinal": {
        const count = Number(value);
        const branches = parseBranches(style ?? "");

        // An exact `=N` match wins over the plural category — that's what lets
        // "=0 {Your cart is empty}" say something other than "0 items".
        const category = new Intl.PluralRules(locale, {
          type: type === "plural" ? "cardinal" : "ordinal",
        }).select(count);

        const branch = branches[`=${count}`] ?? branches[category] ?? branches.other ?? "";
        const formatted = new Intl.NumberFormat(locale).format(count);

        // `#` is the count. Recurse first, then substitute, so a nested message
        // can't accidentally eat the marker.
        out += formatMessage(branch, data, locale).replaceAll("#", formatted);
        break;
      }

      case "select": {
        const branches = parseBranches(style ?? "");
        const branch = branches[String(value)] ?? branches.other ?? "";
        out += formatMessage(branch, data, locale);
        break;
      }

      default:
        // An unknown type: fall back to interpolation rather than throwing.
        out += value == null ? "" : String(value);
    }
  }

  return out;
}

/* --------------------------------- locales -------------------------------- */

/**
 * Pick the best locale for an `Accept-Language` header.
 *
 *   negotiateLocale("fr-CA,fr;q=0.9,en;q=0.8", ["en", "fr"], "en")  // "fr"
 *
 * Exact matches win, then the language part (`fr-CA` → `fr`), in the client's
 * order of preference. Falls back to `defaultLocale` when nothing matches.
 */
export function negotiateLocale(
  header: string | null | undefined,
  supported: string[],
  defaultLocale: string,
): string {
  if (!header) return defaultLocale;

  const wanted = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? Number(q.split("=")[1]) : 1 };
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);

  const lower = new Map(supported.map((locale) => [locale.toLowerCase(), locale]));

  for (const { tag } of wanted) {
    const exact = lower.get(tag);
    if (exact) return exact;

    // `fr-CA` should match a supported `fr`.
    const language = tag.split("-")[0]!;
    const partial = lower.get(language);
    if (partial) return partial;
  }

  return defaultLocale;
}

/* ---------------------------------- i18n ---------------------------------- */

/** One locale, bound to its messages. Get one with `i18n(locale)`. */
export class I18n {
  constructor(
    readonly locale: string,
    private messages: Record<string, string>,
    private manager: I18nManager,
  ) {}

  /** Whether a key resolves in this locale (or its fallbacks). */
  has(key: string): boolean {
    return this.messages[key] !== undefined;
  }

  /**
   * Translate a key, formatting its ICU message with `data`.
   *
   *   t("cart.items", { count: 3 });   // "3 items"
   *
   * A missing key doesn't throw — it goes through the configured `missing`
   * handler (which returns the key itself by default, so the page still renders
   * and the gap is obvious) and fires an `i18n.missing` event.
   */
  t(key: string, data?: Record<string, unknown>): string {
    const message = this.messages[key];
    if (message === undefined) return this.manager.missing(key, this.locale);
    return formatMessage(message, data, this.locale);
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.locale, options).format(value);
  }

  formatCurrency(value: number, currency: string, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.locale, { ...options, style: "currency", currency }).format(value);
  }

  formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(this.locale, options ?? { dateStyle: "medium" }).format(toDate(value));
  }

  formatTime(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(this.locale, options ?? { timeStyle: "medium" }).format(toDate(value));
  }

  /**
   * "3 days ago", "in 2 hours". With no unit, the best one is picked from the
   * distance between `value` and now.
   */
  formatRelativeTime(
    value: Date | number | string,
    unit?: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string {
    const formatter = new Intl.RelativeTimeFormat(this.locale, { numeric: "auto", ...options });
    const deltaMs = toDate(value).getTime() - Date.now();

    if (unit) return formatter.format(Math.round(deltaMs / MS[unit]!), unit);

    // Walk from the coarsest unit down; the first one the delta clears wins.
    for (const candidate of AUTO_UNITS) {
      const size = MS[candidate]!;
      if (Math.abs(deltaMs) >= size || candidate === "second") {
        return formatter.format(Math.round(deltaMs / size), candidate);
      }
    }
    return formatter.format(0, "second");
  }

  /** "a, b, and c" — or "a, b, or c" with `{ type: "disjunction" }`. */
  formatList(items: string[], options?: Intl.ListFormatOptions): string {
    return new Intl.ListFormat(this.locale, options).format(items);
  }

  /** The plural category for a count: "one", "other", … */
  formatPlural(count: number, options?: Intl.PluralRulesOptions): Intl.LDMLPluralRule {
    return new Intl.PluralRules(this.locale, options).select(count);
  }

  /** A language/region/currency code as its display name: "fr" → "French". */
  formatDisplayName(code: string, type: Intl.DisplayNamesOptions["type"] = "language"): string {
    return new Intl.DisplayNames([this.locale], { type }).of(code) ?? code;
  }
}

const MS: Partial<Record<Intl.RelativeTimeFormatUnit, number>> = {
  year: 31_536_000_000,
  quarter: 7_884_000_000,
  month: 2_628_000_000,
  week: 604_800_000,
  day: 86_400_000,
  hour: 3_600_000,
  minute: 60_000,
  second: 1_000,
};

const AUTO_UNITS: Intl.RelativeTimeFormatUnit[] = [
  "year",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
];

/* -------------------------------- manager --------------------------------- */

export interface I18nOptions {
  /** Used when nothing else matches. Default: `"en"`. */
  defaultLocale?: string;
  /**
   * Which locales this app serves. Derived from the loaded translations when
   * omitted.
   */
  supportedLocales?: string[];
  /** Per-locale fallbacks: `{ "es-MX": "es" }`. A language prefix is tried anyway. */
  fallbackLocales?: Record<string, string>;
  /**
   * What to render for a key with no translation. Default: the key itself — so
   * the page still renders and the gap is visible rather than blank.
   */
  missing?: (key: string, locale: string) => string;
}

export class I18nManager {
  private translations = new Map<string, Record<string, string>>();
  private options: Required<Omit<I18nOptions, "supportedLocales">> & { supportedLocales?: string[] };

  constructor(options: I18nOptions = {}) {
    this.options = {
      defaultLocale: options.defaultLocale ?? "en",
      fallbackLocales: options.fallbackLocales ?? {},
      missing: options.missing ?? ((key) => key),
      supportedLocales: options.supportedLocales,
    };
  }

  get defaultLocale(): string {
    return this.options.defaultLocale;
  }

  /** Add translations, merging into whatever is already loaded. */
  add(data: TranslationsByLocale): this {
    for (const [locale, messages] of Object.entries(data)) {
      const existing = this.translations.get(locale) ?? {};
      this.translations.set(locale, { ...existing, ...flatten(messages) });
    }
    return this;
  }

  /** Load from one or more loaders. */
  async load(...loaders: TranslationLoader[]): Promise<this> {
    for (const loader of loaders) this.add(await loader.load());
    return this;
  }

  /** The locales this app serves. */
  supported(): string[] {
    return this.options.supportedLocales ?? [...this.translations.keys()];
  }

  /**
   * The chain to try for a locale: itself, its configured fallback, its language
   * prefix (`es-MX` → `es`), then the default. That's what makes a regional
   * locale usable with only the base language translated.
   */
  private chain(locale: string): string[] {
    const chain = [locale];

    const configured = this.options.fallbackLocales[locale];
    if (configured) chain.push(configured);

    const language = locale.split("-")[0]!;
    if (language !== locale) chain.push(language);

    chain.push(this.options.defaultLocale);
    return [...new Set(chain)];
  }

  /** An `I18n` for a locale, with its fallback chain already flattened in. */
  locale(code?: string): I18n {
    const locale = code ?? this.options.defaultLocale;

    // Later entries in the chain fill only the gaps the earlier ones leave.
    const merged: Record<string, string> = {};
    for (const candidate of this.chain(locale).reverse()) {
      Object.assign(merged, this.translations.get(candidate) ?? {});
    }

    return new I18n(locale, merged, this);
  }

  /** What to render for a missing key — and a chance to notice it. */
  missing(key: string, locale: string): string {
    if (hasApplication()) void emit("i18n.missing", { key, locale });
    return this.options.missing(key, locale);
  }
}

/* --------------------------------- global --------------------------------- */

let manager = new I18nManager();

/** Replace the i18n manager (options and all). */
export function setI18n(next: I18nManager): I18nManager {
  manager = next;
  return manager;
}

/** The active i18n manager. */
export function getI18n(): I18nManager {
  return manager;
}

/** Register translations on the active manager. */
export function setTranslations(data: TranslationsByLocale): I18nManager {
  return manager.add(data);
}

/**
 * An `I18n` for a locale — or, with no argument, the **current request's** locale
 * (set by `detectLocale()`), falling back to the default outside a request.
 */
export function i18n(locale?: string): I18n {
  return manager.locale(locale ?? currentLocale());
}

/** Translate a key in the current request's locale. */
export function t(key: string, data?: Record<string, unknown>): string {
  return i18n().t(key, data);
}

/** Translations from a plain object — the simplest loader. */
export function objectLoader(data: TranslationsByLocale): TranslationLoader {
  return { load: () => data };
}

/* ------------------------------- the request ------------------------------ */

/**
 * The locale `detectLocale()` stored on this request, if we're in one. Outside a
 * request — a CLI command, a queue worker — there's no context, and that's fine:
 * `i18n()` falls back to the default locale.
 */
function currentLocale(): string | undefined {
  try {
    return getContext().get("locale") as string | undefined;
  } catch {
    return undefined;
  }
}

export interface DetectLocaleOptions {
  /** Read `?lang=fr` (or another param). Highest precedence when set. */
  query?: string;
  /** Read a cookie. Checked after the query param, before the header. */
  cookie?: string;
  /** Skip the `Accept-Language` header. Default: false. */
  header?: boolean;
  /** Your own resolver — wins over everything if it returns a locale. */
  resolve?: (c: Parameters<MiddlewareHandler>[0]) => string | undefined;
}

/**
 * Work out the request's locale and stash it, so `t()` and `i18n()` pick it up
 * anywhere in the request without threading it through.
 *
 *   this.use(detectLocale());                    // Accept-Language
 *   this.use(detectLocale({ query: "lang" }));   // ?lang=fr wins
 *
 * Precedence: `resolve` → query → cookie → `Accept-Language` → the default. Only
 * **supported** locales are honored, so `?lang=xx` can't put the app into a locale
 * you have no translations for.
 */
export function detectLocale(options: DetectLocaleOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const supported = manager.supported();
    const isSupported = (value: string | undefined): value is string =>
      value !== undefined && supported.includes(value);

    let locale: string | undefined;

    const custom = options.resolve?.(c);
    if (isSupported(custom)) locale = custom;

    if (!locale && options.query) {
      const value = new URL(c.req.url).searchParams.get(options.query) ?? undefined;
      if (isSupported(value)) locale = value;
    }

    if (!locale && options.cookie) {
      const cookies = c.req.header("Cookie") ?? "";
      const match = new RegExp(`(?:^|;\\s*)${options.cookie}=([^;]+)`).exec(cookies);
      const value = match?.[1];
      if (isSupported(value)) locale = value;
    }

    if (!locale && options.header !== false) {
      locale = negotiateLocale(c.req.header("Accept-Language"), supported, manager.defaultLocale);
    }

    c.set("locale", locale ?? manager.defaultLocale);
    await next();
  };
}
