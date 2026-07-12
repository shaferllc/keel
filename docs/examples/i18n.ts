// Type-check harness for docs/i18n.md. Compile-only — never executed.
import {
  i18n,
  t,
  setI18n,
  getI18n,
  setTranslations,
  detectLocale,
  negotiateLocale,
  formatMessage,
  objectLoader,
  I18n,
  I18nManager,
  HttpKernel,
  ServiceProvider,
  listen,
  logger,
  type TranslationsByLocale,
  type TranslationLoader,
  type I18nOptions,
  type DetectLocaleOptions,
} from "@shaferllc/keel/core";

declare const order: { createdAt: Date };
declare const post: { publishedAt: Date };
declare const names: string[];

export class I18nServiceProvider extends ServiceProvider {
  boot(): void {
    setI18n(new I18nManager({ defaultLocale: "en" }));

    setTranslations({
      en: { "cart.items": "{count, plural, one {# item} other {# items}}" },
      fr: { "cart.items": "{count, plural, one {# article} other {# articles}}" },
    });

    this.app.make(HttpKernel).use(detectLocale());
  }
}

export function translating() {
  return [t("cart.items", { count: 3 }), i18n("fr").t("cart.items", { count: 3 })];
}

export function formatters() {
  const l: I18n = i18n();
  return {
    number: l.formatNumber(1234.5),
    currency: l.formatCurrency(9.5, "USD"),
    date: l.formatDate(order.createdAt),
    time: l.formatTime(order.createdAt),
    relative: l.formatRelativeTime(post.publishedAt),
    relativeUnit: l.formatRelativeTime(post.publishedAt, "hour"),
    list: l.formatList(["a", "b", "c"]),
    or: l.formatList(names, { type: "disjunction" }),
    plural: l.formatPlural(5),
    display: l.formatDisplayName("fr"),
    has: l.has("cart.items"),
    locale: l.locale,
  };
}

export function detection(): DetectLocaleOptions[] {
  return [{}, { query: "lang" }, { cookie: "locale" }, { header: false }, { resolve: () => "fr" }];
}

export function middleware() {
  return [detectLocale(), detectLocale({ query: "lang", cookie: "locale" })];
}

export function negotiating() {
  return negotiateLocale("fr-CA,fr;q=0.9,en;q=0.8", ["en", "fr"], "en");
}

export function messages() {
  return [
    formatMessage("Hello {name}!", { name: "Ada" }),
    formatMessage("{count, plural, =0 {Empty} one {# item} other {# items}}", { count: 3 }, "en"),
    formatMessage("{n, selectordinal, one {#st} other {#th}}", { n: 1 }, "en"),
    formatMessage("{gender, select, male {He} other {They}}", { gender: "male" }),
    formatMessage("{n, number, ::currency/USD}", { n: 9.5 }, "en-US"),
  ];
}

export function fallbacks() {
  setTranslations({
    es: { greeting: "Hola", chair: "silla" },
    "es-MX": { chair: "banca" },
  });

  return [i18n("es-MX").t("chair"), i18n("es-MX").t("greeting")];
}

export function missingKeys() {
  listen("i18n.missing", (payload) => {
    const { key, locale } = payload as { key: string; locale: string };
    logger().warn("missing translation", { key, locale });
  });

  const options: I18nOptions = {
    defaultLocale: "en",
    supportedLocales: ["en", "fr"],
    fallbackLocales: { "es-MX": "es" },
    missing: (key, locale) => `[${locale}:${key}]`,
  };
  return new I18nManager(options);
}

export async function loaders() {
  const data: TranslationsByLocale = { en: { hi: "Hi" } };
  const loader: TranslationLoader = objectLoader(data);

  const manager = new I18nManager();
  await manager.load(loader);

  return { manager, supported: manager.supported(), active: getI18n().defaultLocale };
}
