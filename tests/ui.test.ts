import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "hono/jsx";
import { View } from "../src/core/view.js";
import {
  Alert,
  Brand,
  Button,
  Field,
  Grain,
  Hero,
  HeroGlow,
  HeroInner,
  Notice,
  Panel,
  Rise,
  SectionLabel,
  Shell,
  ShellLinks,
  ShellNav,
  classes,
  cx,
  Container,
  Bar,
  Stack,
  Grid,
  Divider,
  Footer,
  Card,
  CardTitle,
  CardBody,
  Badge,
  Code,
  Pre,
  Prose,
  Table,
  ThemeScript,
  ThemeToggle,
} from "../src/ui/index.js";
import { SpecimenPage } from "../src/ui/specimen.js";

const view = new View({ doctype: false });
const h = createElement;

async function html(node: unknown): Promise<string> {
  return view.render(node as never);
}

describe("keel/ui", () => {
  it("cx joins truthy class names", () => {
    assert.equal(cx("a", false, null, undefined, "b"), "a b");
  });

  it("exports stable class escapes", () => {
    assert.equal(classes.btnPrimary, "keel-btn keel-btn--primary");
    assert.equal(classes.field, "keel-field");
  });

  it("renders Button as button or anchor", async () => {
    const button = await html(h(Button, { type: "submit", variant: "sea" }, "Go"));
    assert.match(button, /class="keel-btn keel-btn--sea"/);
    assert.match(button, /type="submit"/);
    assert.match(button, />Go</);

    const link = await html(h(Button, { href: "/login", variant: "ghost" }, "Log in"));
    assert.match(link, /<a href="\/login"/);
    assert.match(link, /keel-btn--ghost/);
  });

  it("renders Field, Panel, Notice, Alert", async () => {
    const field = await html(
      h(Field, { name: "email", type: "email", placeholder: "Email", required: true }),
    );
    assert.match(field, /class="keel-field"/);
    assert.match(field, /type="email"/);
    assert.match(field, /name="email"/);

    const panel = await html(h(Panel, { variant: "auth" }, "Hi"));
    assert.match(panel, /keel-panel--auth/);
    assert.match(panel, />Hi</);

    const notice = await html(h(Notice, null, "Confirm"));
    assert.match(notice, /keel-notice/);

    const alert = await html(h(Alert, null, "Nope"));
    assert.match(alert, /keel-alert/);
    assert.match(alert, />Nope</);
  });

  it("renders shell and hero primitives", async () => {
    const shell = await html(
      h(
        Shell,
        null,
        h(
          ShellNav,
          null,
          h(Brand, { href: "/" }, "Keel"),
          h(ShellLinks, null, h("a", { href: "/dashboard" }, "Dashboard")),
        ),
        h(SectionLabel, null, "Security"),
      ),
    );
    assert.match(shell, /keel-shell/);
    assert.match(shell, /keel-brand/);
    assert.match(shell, /keel-shell-links/);
    assert.match(shell, /keel-section-label/);

    const hero = await html(
      h(Hero, null, h(HeroGlow, null), h(HeroInner, null, h(Rise, { step: 1 }, "Hello"))),
    );
    assert.match(hero, /keel-hero/);
    assert.match(hero, /keel-hero-glow/);
    assert.match(hero, /keel-rise--1/);
  });

  it("renders Grain overlay", async () => {
    const grain = await html(h(Grain, null));
    assert.match(grain, /keel-grain/);
    assert.match(grain, /aria-hidden="true"/);
  });

  it("renders layout primitives", async () => {
    assert.match(await html(h(Container, null, "x")), /class="keel-container"/);
    assert.match(await html(h(Container, { size: "narrow" }, "x")), /keel-container--narrow/);
    assert.match(await html(h(Container, { as: "main" }, "x")), /^<main/);
    assert.match(await html(h(Bar, null, "x")), /<header class="keel-bar"/);
    assert.match(await html(h(Stack, { gap: "loose" }, "x")), /keel-stack--loose/);
    assert.match(await html(h(Grid, { cols: 3 }, "x")), /keel-grid--3/);
    assert.match(await html(h(Divider, null)), /<hr class="keel-divider"/);
    assert.match(await html(h(Footer, null, "x")), /<footer class="keel-footer"/);
  });

  it("renders Card as a div, or as a lifting link", async () => {
    const card = await html(h(Card, null, h(CardTitle, null, "T"), h(CardBody, null, "B")));
    assert.match(card, /<div class="keel-card"/);
    assert.match(card, /<h3 class="keel-card-title">T</);
    assert.match(card, /<p class="keel-card-body">B</);

    const link = await html(h(Card, { href: "/docs" }, "x"));
    assert.match(link, /<a href="\/docs" class="keel-card keel-card--link"/);
  });

  it("renders Badge tones", async () => {
    assert.match(await html(h(Badge, null, "x")), /class="keel-badge"/);
    assert.match(await html(h(Badge, { tone: "danger" }, "x")), /keel-badge--danger/);
  });

  it("renders text and data primitives", async () => {
    assert.match(await html(h(Code, null, "npm")), /<code class="keel-code">npm</);
    assert.match(await html(h(Pre, null, "a < b")), /<pre class="keel-pre">a &lt; b</);
    assert.match(await html(h(Prose, { as: "article" }, "x")), /<article class="keel-prose"/);
    assert.match(await html(h(Table, { fixed: true }, "x")), /keel-table--fixed/);
  });

  it("renders the theme script and toggle", async () => {
    const script = await html(h(ThemeScript, null));
    assert.match(script, /^<script>/);
    assert.match(script, /keel-theme/);
    assert.match(script, /data-keel-theme-toggle/);
    assert.match(await html(h(ThemeScript, { nonce: "abc123" })), /<script nonce="abc123">/);

    // Chrome leaves transitioned properties on the old mode's colour unless the
    // swap happens with transitions off. Both halves of that fix must ship.
    assert.match(script, /keel-theme-switching/);
    assert.match(script, /offsetWidth/, "the swap needs a forced reflow");
    assert.match(script, /matchMedia\("\(prefers-color-scheme: dark\)"\)\.addEventListener/);

    const toggle = await html(h(ThemeToggle, null));
    assert.match(toggle, /class="keel-theme-toggle"/);
    assert.match(toggle, /data-keel-theme-toggle/);
    assert.match(toggle, /aria-label="Switch colour theme"/);
    // Both icons ship; CSS decides which one is visible.
    assert.match(toggle, /keel-theme-icon--to-dark/);
    assert.match(toggle, /keel-theme-icon--to-light/);
  });

  it("renders a complete specimen document", async () => {
    // `view` here renders without a doctype; build:specimen adds one.
    const page = await html(h(SpecimenPage, { stylesheet: "/assets/app.css" }));
    assert.match(page, /^<html lang="en">/);
    assert.match(page, /<link rel="stylesheet" href="\/assets\/app.css"/);
    assert.match(page, /<title>Keel UI — specimen<\/title>/);

    // The specimen exists to exercise the kit — assert it actually does.
    for (const cls of [
      "keel-body",
      "keel-bar",
      "keel-container",
      "keel-grid",
      "keel-card",
      "keel-badge",
      "keel-panel",
      "keel-notice",
      "keel-alert",
      "keel-table",
      "keel-pre",
      "keel-prose",
      "keel-divider",
      "keel-footer",
      "keel-theme-toggle",
    ]) {
      assert.ok(page.includes(cls), `specimen is missing ${cls}`);
    }
  });
});
