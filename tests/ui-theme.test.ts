/**
 * The design tokens are a contract: two blocks that must agree, and a set of
 * colour pairs that must stay legible in both modes. Neither survives eyeballing
 * a screenshot, so both are asserted here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "../src/ui");
const themeCss = readFileSync(join(uiDir, "theme.css"), "utf8");
const componentsCss = readFileSync(join(uiDir, "components.css"), "utf8");

type Mode = "light" | "dark";
type Rgb = [number, number, number];

/** `--color-x: light-dark(#aaa, #bbb);` pairs inside one CSS block. */
function tokensIn(block: string): Map<string, [string, string]> {
  const found = new Map<string, [string, string]>();
  const re = /(--color-[\w-]+):\s*light-dark\(\s*(#[0-9a-f]{3,8})\s*,\s*(#[0-9a-f]{3,8})\s*\)/gi;
  for (const m of block.matchAll(re)) found.set(m[1]!, [m[2]!, m[3]!]);
  return found;
}

function block(name: ":root" | "@theme"): string {
  const start = themeCss.indexOf(name === ":root" ? ":root {" : "@theme {");
  assert.ok(start >= 0, `${name} block missing from theme.css`);
  const end = themeCss.indexOf("\n}", start);
  return themeCss.slice(start, end);
}

const rootTokens = tokensIn(block(":root"));
const themeTokens = tokensIn(block("@theme"));

/* --------------------------------- colour --------------------------------- */

function hexToRgb(hex: string): Rgb {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
};

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: Rgb): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** `color-mix(in oklab, a p%, b)` with two opaque colours. */
function mixOklab(a: Rgb, b: Rgb, weightOfA: number): Rgb {
  const [la, aa, ba] = toOklab(a);
  const [lb, ab, bb] = toOklab(b);
  const t = weightOfA;
  return fromOklab([la! * t + lb! * (1 - t), aa! * t + ab! * (1 - t), ba! * t + bb! * (1 - t)]);
}

/** `color-mix(in oklab, a p%, transparent)` painted over `over` — alpha compositing is sRGB. */
function tintOver(a: Rgb, over: Rgb, alpha: number): Rgb {
  return a.map((c, i) => Math.round(c * alpha + over[i]! * (1 - alpha))) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function token(name: string, mode: Mode): Rgb {
  const pair = rootTokens.get(name);
  assert.ok(pair, `token ${name} is not declared in theme.css`);
  return hexToRgb(mode === "light" ? pair[0] : pair[1]);
}

/* ---------------------------------- tests --------------------------------- */

describe("keel/ui theme tokens", () => {
  it("declares every colour token as a light/dark pair", () => {
    assert.ok(rootTokens.size >= 14, `only ${rootTokens.size} tokens found`);
    for (const name of ["--color-ink", "--color-sea", "--color-surface", "--color-on-accent"]) {
      assert.ok(rootTokens.has(name), `${name} missing`);
    }
  });

  // The :root and @theme blocks are duplicated so the kit works with and
  // without Tailwind. Duplication only stays honest if something checks it.
  it("keeps the :root and @theme blocks in sync", () => {
    assert.deepEqual(
      [...themeTokens.entries()].sort(),
      [...rootTokens.entries()].sort(),
      "@theme and :root declare different colour values",
    );
  });

  it("sets color-scheme so light-dark() resolves, and both overrides exist", () => {
    assert.match(themeCss, /color-scheme:\s*light dark/);
    assert.match(themeCss, /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light/);
    assert.match(themeCss, /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark/);
  });

  it("loads no remote fonts from the token sheet", () => {
    assert.doesNotMatch(themeCss, /@import\s+url\(/, "theme.css must not fetch a third-party font");
    assert.doesNotMatch(themeCss, /fonts\.googleapis|fonts\.gstatic/);
  });
});

describe("keel/ui components", () => {
  // Hardcoded whites were what pinned the kit to light mode.
  it("paints from tokens, never from a literal white", () => {
    const offenders = componentsCss
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      // `white` as a colour keyword — not `white-space`.
      .filter(([, line]) => /#fff\b|#ffffff\b|(?<![-\w])white(?![-\w])/i.test(line))
      .filter(([, line]) => !line.trim().startsWith("*") && !line.trim().startsWith("/*"));
    assert.deepEqual(offenders, [], "literal whites break dark mode");
  });

  it("guards its animations behind prefers-reduced-motion", () => {
    assert.match(componentsCss, /@media \(prefers-reduced-motion: reduce\)/);
  });

  // Without this rule a theme toggle leaves every transitioned colour — button
  // fills, card and field borders — painted in the mode you just left.
  it("kills transitions while the theme swaps", () => {
    assert.match(componentsCss, /\.keel-theme-switching \*,/);
    assert.match(componentsCss, /transition: none !important/);
  });
});

/** fg token, bg description, bg colour, and the floor it must clear. */
const PAIRS: Array<[string, string, (m: Mode) => Rgb, number]> = [
  ["--color-ink", "page", (m) => token("--color-foam", m), 7],
  ["--color-ink-soft", "page", (m) => token("--color-foam", m), 4.5],
  [
    "--color-ink-soft",
    "card",
    (m) => mixOklab(token("--color-surface", m), token("--color-foam", m), 0.86),
    4.5,
  ],
  ["--color-sea", "page (links)", (m) => token("--color-foam", m), 4.5],
  ["--color-on-accent", "primary button", (m) => token("--color-ink", m), 7],
  ["--color-on-accent", "sea button", (m) => token("--color-sea", m), 4.5],
  ["--color-on-accent", "sea-deep hover", (m) => token("--color-sea-deep", m), 4.5],
  [
    "--color-danger",
    "alert",
    (m) => mixOklab(token("--color-danger", m), token("--color-surface", m), 0.08),
    4.5,
  ],
  [
    "--color-warn",
    "notice",
    (m) => mixOklab(token("--color-brass", m), token("--color-surface", m), 0.1),
    4.5,
  ],
  [
    "--color-sea",
    "sea badge",
    (m) => tintOver(token("--color-sea", m), token("--color-foam", m), 0.12),
    4.5,
  ],
  [
    "--color-warn",
    "brass badge",
    (m) => tintOver(token("--color-brass", m), token("--color-foam", m), 0.12),
    4.5,
  ],
  [
    "--color-danger",
    "danger badge",
    (m) => tintOver(token("--color-danger", m), token("--color-foam", m), 0.1),
    4.5,
  ],
];

describe("keel/ui contrast", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const [fg, where, bg, floor] of PAIRS) {
      it(`${mode}: ${fg} on ${where} clears ${floor}:1`, () => {
        const value = contrast(token(fg, mode), bg(mode));
        assert.ok(
          value >= floor,
          `${fg} on ${where} in ${mode} is ${value.toFixed(2)}:1, want ${floor}:1`,
        );
      });
    }
  }

  // Borders are not text, but an invisible border is still a broken component.
  for (const mode of ["light", "dark"] as const) {
    it(`${mode}: --color-line is visible against the page`, () => {
      const value = contrast(token("--color-line", mode), token("--color-foam", mode));
      assert.ok(value >= 1.2, `--color-line in ${mode} is ${value.toFixed(2)}:1`);
    });
  }
});
