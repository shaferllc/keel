import { test } from "node:test";
import assert from "node:assert/strict";

import { TemplateEngine, escapeHtml } from "../src/core/template.js";

function engine() {
  return new TemplateEngine();
}

test("escaped interpolation escapes HTML; raw does not", async () => {
  const t = engine();
  t.register("e", "{{ html }}");
  t.register("r", "{{{ html }}}");
  const state = { html: "<b>&\"'</b>" };
  assert.equal(await t.render("e", state), "&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;");
  assert.equal(await t.render("r", state), "<b>&\"'</b>");
});

test("nullish interpolation renders empty", async () => {
  const t = engine();
  t.register("n", "[{{ missing }}]");
  assert.equal(await t.render("n", {}), "[]");
});

test("comments are stripped", async () => {
  const t = engine();
  t.register("c", "a{{-- hidden {{ x }} --}}b");
  assert.equal(await t.render("c", { x: 1 }), "ab");
});

test("expressions: member, index, method calls, operators, ternary", async () => {
  const t = engine();
  t.register("m", "{{ user.name }}");
  t.register("i", "{{ items[1] }}");
  t.register("meth", "{{ name.toUpperCase() }}");
  t.register("op", "{{ a + b * 2 }}");
  t.register("cmp", "{{ n > 3 ? 'big' : 'small' }}");
  t.register("join", "{{ items.join(', ') }}");
  assert.equal(await t.render("m", { user: { name: "Ada" } }), "Ada");
  assert.equal(await t.render("i", { items: ["a", "b", "c"] }), "b");
  assert.equal(await t.render("meth", { name: "ada" }), "ADA");
  assert.equal(await t.render("op", { a: 1, b: 3 }), "7");
  assert.equal(await t.render("cmp", { n: 5 }), "big");
  assert.equal(await t.render("join", { items: [1, 2, 3] }), "1, 2, 3");
});

test("expressions: arrays, objects, logical, nullish", async () => {
  const t = engine();
  t.register("arr", "{{ [1, 2, 3].length }}");
  t.register("or", "{{ a || 'default' }}");
  t.register("nc", "{{ a ?? 'fallback' }}");
  assert.equal(await t.render("arr", {}), "3");
  assert.equal(await t.render("or", { a: "" }), "default");
  assert.equal(await t.render("nc", { a: 0 }), "0");
});

test("filters (pipes) transform values", async () => {
  const t = engine();
  t.filter("repeat", (v, n) => String(v).repeat(n as number));
  t.register("u", "{{ name | upper }}");
  t.register("chain", "{{ name | upper | length }}");
  t.register("arg", "{{ x | repeat(3) }}");
  assert.equal(await t.render("u", { name: "ada" }), "ADA");
  assert.equal(await t.render("chain", { name: "ada" }), "3");
  assert.equal(await t.render("arg", { x: "ab" }), "ababab");
});

test("@if / @elseif / @else", async () => {
  const t = engine();
  t.register("c", "@if(n > 10)big@elseif(n > 5)mid@else small@end");
  assert.equal((await t.render("c", { n: 20 })).trim(), "big");
  assert.equal((await t.render("c", { n: 7 })).trim(), "mid");
  assert.equal((await t.render("c", { n: 1 })).trim(), "small");
});

test("@each with $loop and index", async () => {
  const t = engine();
  t.register("e", "@each(item in items){{ $loop.iteration }}:{{ item }}{{ $loop.last ? '' : '|' }}@end");
  assert.equal(await t.render("e", { items: ["a", "b", "c"] }), "1:a|2:b|3:c");

  t.register("idx", "@each(v, i in items){{ i }}={{ v }} @end");
  assert.equal((await t.render("idx", { items: ["x", "y"] })).trim(), "0=x 1=y");
});

test("@each over an empty or missing list renders nothing", async () => {
  const t = engine();
  t.register("e", "[@each(x in items){{ x }}@end]");
  assert.equal(await t.render("e", { items: [] }), "[]");
  assert.equal(await t.render("e", {}), "[]");
});

test("@set defines a variable", async () => {
  const t = engine();
  t.register("s", "@set('total', price * qty){{ total }}");
  assert.equal(await t.render("s", { price: 3, qty: 4 }), "12");
});

test("@include and @includeIf pull in partials with shared scope", async () => {
  const t = engine();
  t.register("row", "<li>{{ item }}</li>");
  t.register("list", "<ul>@each(item in items)@include('row')@end</ul>");
  assert.equal(await t.render("list", { items: ["a", "b"] }), "<ul><li>a</li><li>b</li></ul>");

  t.register("maybe", "@includeIf(show, 'row')");
  assert.equal(await t.render("maybe", { show: true, item: "x" }), "<li>x</li>");
  assert.equal(await t.render("maybe", { show: false, item: "x" }), "");
});

test("layouts: @layout + @section + @yield with fallback", async () => {
  const t = engine();
  t.register("base", "<html><head>@yield('head')default-head@end</head><body>@yield('body')@end</body></html>");
  t.register(
    "page",
    "@layout('base')@section('body')<h1>{{ title }}</h1>@end",
  );
  assert.equal(
    await t.render("page", { title: "Hi" }),
    "<html><head>default-head</head><body><h1>Hi</h1></body></html>",
  );
});

test("components with default and named slots", async () => {
  const t = engine();
  t.register("card", "<div class='card'><header>{{{ slots.header }}}</header><main>{{{ slots.main }}}</main><span>{{ title }}</span></div>");
  t.register(
    "page",
    "@component('card', { title: 'Hello' })@slot('header')<b>H</b>@end<p>body</p>@end",
  );
  assert.equal(
    await t.render("page", {}),
    "<div class='card'><header><b>H</b></header><main><p>body</p></main><span>Hello</span></div>",
  );
});

test("globals and default filters are available everywhere", async () => {
  const t = engine();
  t.global("appName", "Keel");
  t.global("shout", (s: string) => s + "!");
  t.register("g", "{{ appName }} {{ shout('hi') }} {{ 'x' | upper }}");
  assert.equal(await t.render("g", {}), "Keel hi! X");
});

test("blocks prototype-polluting access", async () => {
  const t = engine();
  t.register("bad", "{{ obj.__proto__ }}");
  await assert.rejects(() => t.render("bad", { obj: {} }), /not allowed/);
});

test("helpful errors for unknown template, tag, and filter", async () => {
  const t = engine();
  await assert.rejects(() => t.render("nope", {}), /no template named 'nope'/);
  // parse-time error surfaces at register
  assert.throws(() => t.register("t2", "@bogus()"), /unknown tag @bogus/);
  t.register("f", "{{ x | nope }}");
  await assert.rejects(() => t.render("f", { x: 1 }), /unknown filter 'nope'/);
});

test("escapeHtml is exported and standalone", () => {
  assert.equal(escapeHtml("<a href=\"x\">&'"), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(42), "42");
});
