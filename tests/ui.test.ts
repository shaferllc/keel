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
} from "../src/ui/index.js";

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
});
