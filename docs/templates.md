# Templates

A string templating engine — `{{ }}` interpolation and `@`-prefixed tags for
logic, includes, layouts, and components. Reach for it when you want plain-text
templates instead of (or alongside) [JSX views](./views.md).

Unlike engines that compile a template to a function with `eval` /
`new Function`, Keel **interprets** templates against a small, safe expression
evaluator. No dynamic code generation, so the same templates run on Node **and**
on Cloudflare Workers (where `eval` is forbidden).

## Rendering

Register a template by name, then render it with a state object:

```ts
import { templates, render } from "@shaferllc/keel/core";

templates().register("greeting", "Hello, {{ name }}!");

await render("greeting", { name: "Ada" }); // "Hello, Ada!"
```

`render()` returns a `Promise<string>` — hand it to a response or a [view](./views.md):

```ts
import { html, render } from "@shaferllc/keel/core";
return html(await render("greeting", { name: "Ada" }));
```

Register many at once (e.g. a Node loader reads `.html` files and passes them in):

```ts
templates().registerAll({
  layout: await readFile("views/layout.html", "utf8"),
  home: await readFile("views/home.html", "utf8"),
});
```

## Interpolation

```html
{{ user.name }}      {{-- escaped: HTML-safe --}}
{{{ post.body }}}    {{-- raw: unescaped, for trusted HTML --}}
{{-- this is a comment; it renders nothing --}}
```

Escaped `{{ }}` is the default and encodes `& < > " '`. Use raw `{{{ }}}` only for
HTML you trust. A `null`/`undefined` value renders as an empty string.

## Expressions

Interpolation and tag conditions accept a practical subset of JavaScript —
enough for real templates, without `eval`:

```html
{{ user.name }}                     {{-- property + index access --}}
{{ items[0] }}
{{ title.toUpperCase() }}           {{-- method calls --}}
{{ items.join(", ") }}
{{ price * qty }}                    {{-- + - * / % --}}
{{ n > 3 && n < 10 }}               {{-- comparisons, && || ! ?? --}}
{{ admin ? "Admin" : "User" }}      {{-- ternary --}}
{{ [1, 2, 3].length }}              {{-- array / object literals --}}
{{ { role: "admin" }.role }}
```

Not supported: assignment, arrow functions, and other statement-level JS. Keep
logic in your controller and pass results in as state.

### Filters

Pipe a value through a filter with `|`:

```html
{{ name | upper }}
{{ name | capitalize }}
{{ items | length }}
{{ price | currency("USD") }}    {{-- filters take arguments --}}
```

Built-in filters: `upper`, `lower`, `capitalize`, `json`, `length`. Register your
own on the engine:

```ts
templates().filter("currency", (v, code) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: String(code) }).format(Number(v)),
);
```

## Conditionals

```html
@if(user.admin)
  <span>Admin</span>
@elseif(user.member)
  <span>Member</span>
@else
  <span>Guest</span>
@end
```

## Loops

`@each` iterates arrays (or the values of an object). A `$loop` variable exposes
positional info, and you can capture the index:

```html
<ul>
@each(post in posts)
  <li>{{ $loop.iteration }}. {{ post.title }}</li>
@end
</ul>

@each(item, i in items)
  {{ i }}: {{ item }}
@end
```

`$loop` fields: `index` (0-based), `iteration` (1-based), `first`, `last`,
`count`, `even`, `odd`.

## Partials

Pull one template into another with `@include` — it shares the current state:

```html
{{-- list.html --}}
<ul>@each(item in items)@include("row")@end</ul>

{{-- row.html --}}
<li>{{ item }}</li>
```

`@includeIf(condition, "name")` includes only when the condition is truthy.

## Layouts

A page declares its layout and fills the layout's `@yield` slots with `@section`:

```html
{{-- layout.html --}}
<!doctype html>
<title>@yield("title")Keel@end</title>
<body>@yield("body")@end</body>

{{-- page.html --}}
@layout("layout")
@section("title"){{ page.title }} · Keel@end
@section("body")<h1>{{ page.title }}</h1>@end
```

`@yield("name") … @end` renders the matching section, falling back to the content
between `@yield` and `@end` when the page defines no such section.

## Components

Components are reusable templates rendered with props and slots. The content
between `@component` and its `@end` becomes the `main` slot; `@slot("name")`
defines named slots. Inside the component, slots arrive as pre-rendered HTML
strings on a `slots` object:

```html
{{-- card.html --}}
<div class="card">
  <header>{{{ slots.header }}}</header>
  <main>{{{ slots.main }}}</main>
  <footer>{{ title }}</footer>
</div>

{{-- usage --}}
@component("card", { title: "Welcome" })
  @slot("header")<h2>Hi</h2>@end
  <p>Body content goes to the main slot.</p>
@end
```

Props are any expression evaluating to an object; they become the component's
state (merged with globals).

## Globals

Expose values or helpers to every template:

```ts
templates()
  .global("appName", "Keel")
  .global("asset", (path: string) => `/static/${path}`);
```

```html
<title>{{ appName }}</title>
<img src="{{ asset('logo.svg') }}" />
```

## Debugging

`@dump(value)` renders a `<pre>` of the value's JSON — handy while building a
template.

```html
@dump(user)
```

## Escaping & safety

- Escaped `{{ }}` encodes HTML; only use raw `{{{ }}}` for trusted content.
- The evaluator blocks access to `__proto__`, `constructor`, and `prototype`, so
  template state can't be used to reach the prototype chain.
- There's no `eval`: a template can't execute arbitrary JavaScript, only the
  expression subset above.

## API reference

### `templates()`

`templates(): TemplateEngine`

Returns the default engine — register templates, globals, and filters on it.

```ts
templates().register("home", "…");
```

**Notes:** module-global and shared. Swap it with `setTemplateEngine()` (e.g. for
an isolated engine in a test).

### `render(name, state?)`

`render(name: string, state?: Record<string, unknown>): Promise<string>`

Renders a registered template on the default engine.

```ts
await render("home", { user });
```

**Notes:** throws if `name` isn't registered. Async because includes, components,
and layouts compose asynchronously.

### `setTemplateEngine(engine)`

`setTemplateEngine(engine: TemplateEngine): TemplateEngine`

Replaces the default engine and returns it.

**Notes:** the last call wins; useful to reset state between tests.

### `escapeHtml(value)`

`escapeHtml(value: unknown): string`

HTML-escapes a value (`& < > " '`); `null`/`undefined` become `""`. This is what
`{{ }}` uses internally.

### `TemplateEngine`

The engine class. Construct your own for isolation, or use `templates()`.

#### `register(name, source)`

`register(name: string, source: string): this`

Parses and registers a template. Chainable.

**Notes:** parsing happens here, so a malformed template throws at registration,
not at render.

#### `registerAll(sources)`

`registerAll(sources: Record<string, string>): this`

Registers many templates at once from a `name → source` map.

#### `has(name)`

`has(name: string): boolean`

Whether a template is registered.

#### `global(name, value)`

`global(name: string, value: unknown): this`

Exposes a value or function to every template as a global variable.

#### `filter(name, fn)`

`filter(name: string, fn: Filter): this`

Registers a `{{ value | name }}` filter. `Filter` is
`(value: unknown, ...args: unknown[]) => unknown`.

#### `render(name, state?)`

`render(name: string, state?: Record<string, unknown>): Promise<string>`

Renders a registered template. Throws for an unknown template, tag, or filter.

### Interfaces & types

#### `Filter`

`type Filter = (value: unknown, ...args: unknown[]) => unknown`

A pipe filter: receives the piped value plus any `filter(arg)` arguments, returns
the transformed value.

#### `RenderContext`

`interface RenderContext { sections: Record<string, string>; slots: Record<string, string> }`

Internal per-render state threaded through layouts and components — you won't
construct it directly.
