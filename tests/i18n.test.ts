import { test } from "node:test";
import assert from "node:assert/strict";

import {
  I18nManager,
  formatMessage,
  negotiateLocale,
  detectLocale,
  setI18n,
  setTranslations,
  getI18n,
  i18n,
  t,
  objectLoader,
} from "../src/core/i18n.js";

/* ---------------------------- the ICU formatter --------------------------- */

test("interpolation substitutes named arguments", () => {
  assert.equal(formatMessage("Hello {name}!", { name: "Ada" }), "Hello Ada!");
  assert.equal(formatMessage("{a} and {b}", { a: 1, b: 2 }), "1 and 2");
  // A missing argument renders as empty rather than throwing.
  assert.equal(formatMessage("Hi {name}", {}), "Hi ");
  assert.equal(formatMessage("no args here", {}), "no args here");
});

test("plural picks a category and # becomes the count", () => {
  const message = "{count, plural, one {# item} other {# items}}";

  assert.equal(formatMessage(message, { count: 1 }, "en"), "1 item");
  assert.equal(formatMessage(message, { count: 5 }, "en"), "5 items");
});

test("an exact =N branch beats the plural category", () => {
  // This is the whole point of `=0`: "Your cart is empty" reads better than "0 items".
  const message = "{count, plural, =0 {Your cart is empty} one {# item} other {# items}}";

  assert.equal(formatMessage(message, { count: 0 }, "en"), "Your cart is empty");
  assert.equal(formatMessage(message, { count: 1 }, "en"), "1 item");
  assert.equal(formatMessage(message, { count: 3 }, "en"), "3 items");
});

test("plural categories follow the locale, not English", () => {
  // French treats 0 and 1 as singular; English does not.
  const fr = "{count, plural, one {# article} other {# articles}}";
  assert.equal(formatMessage(fr, { count: 0 }, "fr"), "0 article");
  assert.equal(formatMessage(fr, { count: 1 }, "fr"), "1 article");
  assert.equal(formatMessage(fr, { count: 2 }, "fr"), "2 articles");

  const en = "{count, plural, one {# item} other {# items}}";
  assert.equal(formatMessage(en, { count: 0 }, "en"), "0 items");
});

test("large counts in # are locale-formatted", () => {
  const message = "{count, plural, other {# items}}";
  assert.equal(formatMessage(message, { count: 1234 }, "en-US"), "1,234 items");
});

test("selectordinal", () => {
  const message = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
  assert.equal(formatMessage(message, { n: 1 }, "en"), "1st");
  assert.equal(formatMessage(message, { n: 2 }, "en"), "2nd");
  assert.equal(formatMessage(message, { n: 3 }, "en"), "3rd");
  assert.equal(formatMessage(message, { n: 4 }, "en"), "4th");
  assert.equal(formatMessage(message, { n: 11 }, "en"), "11th");
});

test("select branches on an exact value, falling back to other", () => {
  const message = "{gender, select, male {He} female {She} other {They}} replied";

  assert.equal(formatMessage(message, { gender: "male" }), "He replied");
  assert.equal(formatMessage(message, { gender: "female" }), "She replied");
  assert.equal(formatMessage(message, { gender: "nonbinary" }), "They replied");
  assert.equal(formatMessage(message, {}), "They replied");
});

test("number, date, and time formatting", () => {
  assert.equal(formatMessage("{n, number}", { n: 1234.5 }, "en-US"), "1,234.5");
  assert.equal(formatMessage("{n, number, percent}", { n: 0.25 }, "en-US"), "25%");
  assert.equal(formatMessage("{n, number, integer}", { n: 3.7 }, "en-US"), "4");
  assert.equal(formatMessage("{n, number, ::currency/USD}", { n: 9.5 }, "en-US"), "$9.50");

  const date = new Date("2026-07-11T15:30:00Z");
  assert.match(formatMessage("{d, date, medium}", { d: date }, "en-US"), /Jul 1[01], 2026/);
  assert.ok(formatMessage("{d, time, short}", { d: date }, "en-US").length > 0);
});

test("branches are themselves messages, so they nest", () => {
  const message =
    "{count, plural, =0 {No messages for {name}} one {{name} has # message} other {{name} has # messages}}";

  assert.equal(formatMessage(message, { count: 0, name: "Ada" }, "en"), "No messages for Ada");
  assert.equal(formatMessage(message, { count: 1, name: "Ada" }, "en"), "Ada has 1 message");
  assert.equal(formatMessage(message, { count: 4, name: "Ada" }, "en"), "Ada has 4 messages");
});

test("a select nested inside a plural", () => {
  const message =
    "{count, plural, one {{gender, select, male {He} other {They}} sent # file} other {{gender, select, male {He} other {They}} sent # files}}";

  assert.equal(formatMessage(message, { count: 1, gender: "male" }, "en"), "He sent 1 file");
  assert.equal(formatMessage(message, { count: 3, gender: "x" }, "en"), "They sent 3 files");
});

test("quoted braces are literal", () => {
  assert.equal(formatMessage("Use '{'name'}' to interpolate", {}), "Use {name} to interpolate");
});

test("unbalanced braces throw a clear error", () => {
  assert.throws(() => formatMessage("Hello {name", {}), /unbalanced braces/);
});

/* ------------------------------- negotiation ------------------------------ */

test("negotiateLocale picks the best supported locale", () => {
  assert.equal(negotiateLocale("fr-CA,fr;q=0.9,en;q=0.8", ["en", "fr"], "en"), "fr");
  assert.equal(negotiateLocale("en-US,en;q=0.9", ["en", "fr"], "fr"), "en");

  // Highest q wins, not document order.
  assert.equal(negotiateLocale("en;q=0.2,fr;q=0.9", ["en", "fr"], "en"), "fr");

  // An exact regional match is preferred over the bare language.
  assert.equal(negotiateLocale("pt-BR", ["pt", "pt-BR"], "en"), "pt-BR");

  // Nothing matches → the default.
  assert.equal(negotiateLocale("de,ja", ["en", "fr"], "en"), "en");
  assert.equal(negotiateLocale(null, ["en", "fr"], "fr"), "fr");
  assert.equal(negotiateLocale("", ["en"], "en"), "en");
});

/* --------------------------------- manager -------------------------------- */

test("translations can be nested or flat, and mix", () => {
  const manager = new I18nManager().add({
    en: {
      cart: { items: "{count} items", empty: "Empty" },
      "checkout.title": "Checkout",
    },
  });

  const en = manager.locale("en");
  assert.equal(en.t("cart.items", { count: 2 }), "2 items");
  assert.equal(en.t("cart.empty"), "Empty");
  assert.equal(en.t("checkout.title"), "Checkout");
});

test("a missing key renders as the key itself, so the gap is visible", () => {
  const manager = new I18nManager().add({ en: { hello: "Hi" } });
  assert.equal(manager.locale("en").t("nope.missing"), "nope.missing");
  assert.equal(manager.locale("en").has("nope.missing"), false);
  assert.equal(manager.locale("en").has("hello"), true);
});

test("a custom missing handler wins", () => {
  const manager = new I18nManager({
    missing: (key, locale) => `[${locale}:${key}]`,
  }).add({ en: {} });

  assert.equal(manager.locale("en").t("a.b"), "[en:a.b]");
});

test("an untranslated key falls back to the default locale", () => {
  const manager = new I18nManager({ defaultLocale: "en" }).add({
    en: { greeting: "Hello", farewell: "Bye" },
    fr: { greeting: "Bonjour" }, // no farewell
  });

  const fr = manager.locale("fr");
  assert.equal(fr.t("greeting"), "Bonjour");
  assert.equal(fr.t("farewell"), "Bye", "falls back to English");
});

test("a regional locale falls back to its base language", () => {
  const manager = new I18nManager({ defaultLocale: "en" }).add({
    en: { greeting: "Hello" },
    es: { greeting: "Hola", chair: "silla" },
    "es-MX": { chair: "banca" }, // only overrides one key
  });

  const mx = manager.locale("es-MX");
  assert.equal(mx.t("chair"), "banca", "the regional override wins");
  assert.equal(mx.t("greeting"), "Hola", "and the rest comes from `es`");
});

test("explicit fallbackLocales are honored", () => {
  const manager = new I18nManager({
    defaultLocale: "en",
    fallbackLocales: { nn: "no" }, // Nynorsk falls back to Norwegian, not English
  }).add({
    en: { yes: "yes" },
    no: { yes: "ja" },
    nn: {},
  });

  assert.equal(manager.locale("nn").t("yes"), "ja");
});

test("supported() lists the loaded locales, or the configured list", () => {
  const derived = new I18nManager().add({ en: {}, fr: {} });
  assert.deepEqual(derived.supported().sort(), ["en", "fr"]);

  const configured = new I18nManager({ supportedLocales: ["en"] }).add({ en: {}, fr: {} });
  assert.deepEqual(configured.supported(), ["en"]);
});

test("load() pulls from loaders", async () => {
  const manager = new I18nManager();
  await manager.load(objectLoader({ en: { hi: "Hi" } }), objectLoader({ fr: { hi: "Salut" } }));

  assert.equal(manager.locale("en").t("hi"), "Hi");
  assert.equal(manager.locale("fr").t("hi"), "Salut");
});

/* -------------------------------- formatters ------------------------------ */

test("Intl formatters follow the locale", () => {
  const en = new I18nManager().locale("en-US");
  const de = new I18nManager().locale("de-DE");

  assert.equal(en.formatNumber(1234.5), "1,234.5");
  assert.equal(de.formatNumber(1234.5), "1.234,5");

  assert.equal(en.formatCurrency(9.5, "USD"), "$9.50");
  assert.ok(de.formatCurrency(9.5, "EUR").includes("9,50"));

  assert.equal(en.formatPlural(1), "one");
  assert.equal(en.formatPlural(5), "other");

  assert.equal(en.formatList(["a", "b", "c"]), "a, b, and c");
  assert.equal(en.formatList(["a", "b"], { type: "disjunction" }), "a or b");

  assert.equal(en.formatDisplayName("fr"), "French");
  assert.equal(en.formatDisplayName("USD", "currency"), "US Dollar");
});

test("formatDate and formatTime", () => {
  const en = new I18nManager().locale("en-US");
  const date = new Date("2026-07-11T15:30:00Z");

  assert.match(en.formatDate(date), /Jul 1[01], 2026/);
  assert.match(en.formatDate(date, { year: "numeric" }), /2026/);
  assert.ok(en.formatTime(date).length > 0);
});

test("formatRelativeTime picks a sensible unit on its own", () => {
  const en = new I18nManager().locale("en");
  const now = Date.now();

  assert.equal(en.formatRelativeTime(new Date(now - 3 * 86_400_000)), "3 days ago");
  assert.equal(en.formatRelativeTime(new Date(now + 2 * 3_600_000)), "in 2 hours");
  assert.equal(en.formatRelativeTime(new Date(now - 30_000)), "30 seconds ago");

  // ...or take the unit you give it.
  assert.equal(en.formatRelativeTime(new Date(now - 86_400_000), "hour"), "24 hours ago");
});

/* ---------------------------- the global manager -------------------------- */

test("setTranslations / i18n() / t() work off the global manager", () => {
  setI18n(new I18nManager({ defaultLocale: "en" }));
  setTranslations({
    en: { "cart.items": "{count, plural, one {# item} other {# items}}" },
    fr: { "cart.items": "{count, plural, one {# article} other {# articles}}" },
  });

  // Outside a request, t() uses the default locale.
  assert.equal(t("cart.items", { count: 2 }), "2 items");
  assert.equal(i18n("fr").t("cart.items", { count: 2 }), "2 articles");
  assert.equal(getI18n().defaultLocale, "en");
});

/* ------------------------------- middleware ------------------------------- */

async function run(
  handler: ReturnType<typeof detectLocale>,
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const { Hono } = await import("hono");
  const { contextStorage } = await import("hono/context-storage");

  const app = new Hono();
  app.use("*", contextStorage());
  app.use("*", handler);
  // Read the locale through the global t(), which is the point: no threading.
  app.all("*", (c) => c.text(`${c.get("locale")}|${t("cart.items", { count: 2 })}`));

  const res = await app.request(new Request(url, { headers }));
  return res.text();
}

test("detectLocale reads Accept-Language, and t() picks it up anywhere", async () => {
  setI18n(new I18nManager({ defaultLocale: "en" }));
  setTranslations({
    en: { "cart.items": "{count, plural, one {# item} other {# items}}" },
    fr: { "cart.items": "{count, plural, one {# article} other {# articles}}" },
  });

  assert.equal(await run(detectLocale(), "http://x.test/", { "Accept-Language": "fr" }), "fr|2 articles");
  assert.equal(await run(detectLocale(), "http://x.test/", { "Accept-Language": "en" }), "en|2 items");

  // No header → the default.
  assert.equal(await run(detectLocale(), "http://x.test/"), "en|2 items");
});

test("an unsupported locale cannot be forced", async () => {
  setI18n(new I18nManager({ defaultLocale: "en" }));
  setTranslations({ en: { "cart.items": "{count} items" } });

  // ?lang=fr is ignored — there are no French translations loaded.
  const out = await run(detectLocale({ query: "lang" }), "http://x.test/?lang=fr");
  assert.equal(out, "en|2 items");
});

test("query beats cookie beats header", async () => {
  setI18n(new I18nManager({ defaultLocale: "en" }));
  setTranslations({ en: { "cart.items": "en" }, fr: { "cart.items": "fr" }, de: { "cart.items": "de" } });

  const handler = detectLocale({ query: "lang", cookie: "locale" });

  // Query wins over both.
  assert.equal(
    await run(handler, "http://x.test/?lang=fr", { Cookie: "locale=de", "Accept-Language": "de" }),
    "fr|fr",
  );

  // Cookie wins over the header.
  assert.equal(await run(handler, "http://x.test/", { Cookie: "locale=de", "Accept-Language": "fr" }), "de|de");

  // Header is the last resort.
  assert.equal(await run(handler, "http://x.test/", { "Accept-Language": "fr" }), "fr|fr");
});

test("header detection can be turned off", async () => {
  setI18n(new I18nManager({ defaultLocale: "en" }));
  setTranslations({ en: { "cart.items": "en" }, fr: { "cart.items": "fr" } });

  const out = await run(detectLocale({ header: false }), "http://x.test/", { "Accept-Language": "fr" });
  assert.equal(out, "en|en");
});

test("a custom resolve() wins over everything", async () => {
  setI18n(new I18nManager({ defaultLocale: "en" }));
  setTranslations({ en: { "cart.items": "en" }, fr: { "cart.items": "fr" } });

  const handler = detectLocale({ query: "lang", resolve: () => "fr" });
  assert.equal(await run(handler, "http://x.test/?lang=en"), "fr|fr");
});
