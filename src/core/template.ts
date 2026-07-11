/**
 * A string templating engine in the spirit of Laravel Blade and AdonisJS Edge —
 * `{{ }}` interpolation and `@`-prefixed tags for logic, includes, layouts, and
 * components.
 *
 *   const t = new TemplateEngine();
 *   t.register("hello", "Hello, {{ name }}!");
 *   await t.render("hello", { name: "Ada" }); // "Hello, Ada!"
 *
 * Unlike Blade/Edge, which compile templates to a function via `eval`/`new
 * Function`, this engine *interprets* them against a small, safe expression
 * evaluator — no dynamic code generation — so it runs unchanged on Node and on
 * Cloudflare Workers (where `eval` is forbidden). The expression language is a
 * practical subset of JS: literals, property/index access, method and helper
 * calls, the usual operators, ternaries, arrays/objects, and `|` filters.
 */

/* ------------------------------- escaping --------------------------------- */

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** HTML-escape a value for safe interpolation. */
export function escapeHtml(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/[&<>"']/g, (c) => ESCAPE[c]!);
}

/* ---------------------------- expression lexer ---------------------------- */

type Tok = { t: string; v?: string | number };

const PUNCT = new Set([".", ",", "(", ")", "[", "]", "{", "}", ":", "|", "?"]);

function lexExpr(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const two = ["==", "!=", "<=", ">=", "&&", "||", "??"];
  const three = ["===", "!=="];
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") {
          i++;
          s += src[i] ?? "";
        } else s += src[i];
        i++;
      }
      i++;
      toks.push({ t: "str", v: s });
      continue;
    }
    if (c >= "0" && c <= "9") {
      let n = "";
      while (i < src.length && /[0-9.]/.test(src[i]!)) n += src[i++];
      toks.push({ t: "num", v: Number(n) });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let id = "";
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) id += src[i++];
      if (id === "true" || id === "false") toks.push({ t: "bool", v: id });
      else if (id === "null" || id === "undefined") toks.push({ t: "nullish", v: id });
      else toks.push({ t: "id", v: id });
      continue;
    }
    const t3 = src.slice(i, i + 3);
    if (three.includes(t3)) {
      toks.push({ t: t3 });
      i += 3;
      continue;
    }
    const t2 = src.slice(i, i + 2);
    if (two.includes(t2)) {
      toks.push({ t: t2 });
      i += 2;
      continue;
    }
    if (PUNCT.has(c) || "+-*/%<>!=".includes(c)) {
      toks.push({ t: c });
      i++;
      continue;
    }
    throw new Error(`template: unexpected character '${c}' in expression: ${src}`);
  }
  toks.push({ t: "eof" });
  return toks;
}

/* --------------------------- expression parser ---------------------------- */

type Node =
  | { k: "lit"; v: unknown }
  | { k: "id"; name: string }
  | { k: "member"; obj: Node; prop: string }
  | { k: "index"; obj: Node; idx: Node }
  | { k: "call"; callee: Node; args: Node[] }
  | { k: "unary"; op: string; arg: Node }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "cond"; test: Node; cons: Node; alt: Node }
  | { k: "arr"; items: Node[] }
  | { k: "obj"; entries: [string, Node][] }
  | { k: "pipe"; expr: Node; name: string; args: Node[] };

const BIN_PREC: Record<string, number> = {
  "||": 1, "??": 1,
  "&&": 2,
  "==": 3, "!=": 3, "===": 3, "!==": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

class ExprParser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private peek() {
    return this.toks[this.p]!;
  }
  private next() {
    return this.toks[this.p++]!;
  }
  private expect(t: string) {
    const tok = this.next();
    if (tok.t !== t) throw new Error(`template: expected '${t}', got '${tok.t}'`);
    return tok;
  }

  parse(): Node {
    const node = this.ternary();
    if (this.peek().t !== "eof") throw new Error(`template: trailing tokens in expression`);
    return node;
  }

  private ternary(): Node {
    let node = this.pipe();
    if (this.peek().t === "?") {
      this.next();
      const cons = this.ternary();
      this.expect(":");
      const alt = this.ternary();
      node = { k: "cond", test: node, cons, alt };
    }
    return node;
  }

  private pipe(): Node {
    let node = this.binary(0);
    while (this.peek().t === "|") {
      this.next();
      const name = String(this.expect("id").v);
      const args: Node[] = [];
      if (this.peek().t === "(") {
        this.next();
        while (this.peek().t !== ")") {
          args.push(this.ternary());
          if (this.peek().t === ",") this.next();
        }
        this.expect(")");
      }
      node = { k: "pipe", expr: node, name, args };
    }
    return node;
  }

  private binary(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const op = this.peek().t;
      const prec = BIN_PREC[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.binary(prec + 1);
      left = { k: "bin", op, l: left, r: right };
    }
    return left;
  }

  private unary(): Node {
    const t = this.peek().t;
    if (t === "!" || t === "-") {
      this.next();
      return { k: "unary", op: t, arg: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.primary();
    for (;;) {
      const t = this.peek().t;
      if (t === ".") {
        this.next();
        const prop = String(this.expect("id").v);
        node = { k: "member", obj: node, prop };
      } else if (t === "[") {
        this.next();
        const idx = this.ternary();
        this.expect("]");
        node = { k: "index", obj: node, idx };
      } else if (t === "(") {
        this.next();
        const args: Node[] = [];
        while (this.peek().t !== ")") {
          args.push(this.ternary());
          if (this.peek().t === ",") this.next();
        }
        this.expect(")");
        node = { k: "call", callee: node, args };
      } else break;
    }
    return node;
  }

  private primary(): Node {
    const tok = this.next();
    switch (tok.t) {
      case "num":
        return { k: "lit", v: tok.v };
      case "str":
        return { k: "lit", v: tok.v };
      case "bool":
        return { k: "lit", v: tok.v === "true" };
      case "nullish":
        return { k: "lit", v: tok.v === "null" ? null : undefined };
      case "id":
        return { k: "id", name: String(tok.v) };
      case "(": {
        const node = this.ternary();
        this.expect(")");
        return node;
      }
      case "[": {
        const items: Node[] = [];
        while (this.peek().t !== "]") {
          items.push(this.ternary());
          if (this.peek().t === ",") this.next();
        }
        this.expect("]");
        return { k: "arr", items };
      }
      case "{": {
        const entries: [string, Node][] = [];
        while (this.peek().t !== "}") {
          const keyTok = this.next();
          const key = keyTok.t === "str" ? String(keyTok.v) : String(keyTok.v);
          this.expect(":");
          entries.push([key, this.ternary()]);
          if (this.peek().t === ",") this.next();
        }
        this.expect("}");
        return { k: "obj", entries };
      }
      default:
        throw new Error(`template: unexpected token '${tok.t}' in expression`);
    }
  }
}

const exprCache = new Map<string, Node>();
function compileExpr(src: string): Node {
  let node = exprCache.get(src);
  if (!node) {
    node = new ExprParser(lexExpr(src)).parse();
    exprCache.set(src, node);
  }
  return node;
}

/* -------------------------- expression evaluator -------------------------- */

const BLOCKED = new Set(["__proto__", "constructor", "prototype"]);

export type Filter = (value: unknown, ...args: unknown[]) => unknown;

function member(obj: unknown, prop: string): unknown {
  if (obj == null) return undefined;
  if (BLOCKED.has(prop)) throw new Error(`template: access to '${prop}' is not allowed`);
  return (obj as Record<string, unknown>)[prop];
}

function evalNode(node: Node, scope: Record<string, unknown>, filters: Map<string, Filter>): unknown {
  switch (node.k) {
    case "lit":
      return node.v;
    case "id":
      return scope[node.name];
    case "member":
      return member(evalNode(node.obj, scope, filters), node.prop);
    case "index":
      return member(evalNode(node.obj, scope, filters), String(evalNode(node.idx, scope, filters)));
    case "arr":
      return node.items.map((n) => evalNode(n, scope, filters));
    case "obj": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of node.entries) out[k] = evalNode(v, scope, filters);
      return out;
    }
    case "unary": {
      const v = evalNode(node.arg, scope, filters);
      return node.op === "!" ? !v : -(v as number);
    }
    case "cond":
      return evalNode(node.test, scope, filters)
        ? evalNode(node.cons, scope, filters)
        : evalNode(node.alt, scope, filters);
    case "bin":
      return evalBin(node, scope, filters);
    case "call": {
      const args = node.args.map((a) => evalNode(a, scope, filters));
      if (node.callee.k === "member") {
        const obj = evalNode(node.callee.obj, scope, filters);
        const fn = member(obj, node.callee.prop);
        if (typeof fn !== "function") {
          throw new Error(`template: '${node.callee.prop}' is not a function`);
        }
        return (fn as (...a: unknown[]) => unknown).apply(obj, args);
      }
      const fn = evalNode(node.callee, scope, filters);
      if (typeof fn !== "function") throw new Error(`template: value is not callable`);
      return (fn as (...a: unknown[]) => unknown)(...args);
    }
    case "pipe": {
      const filter = filters.get(node.name);
      if (!filter) throw new Error(`template: unknown filter '${node.name}'`);
      const value = evalNode(node.expr, scope, filters);
      const args = node.args.map((a) => evalNode(a, scope, filters));
      return filter(value, ...args);
    }
  }
}

function evalBin(node: Node & { k: "bin" }, scope: Record<string, unknown>, filters: Map<string, Filter>): unknown {
  const { op } = node;
  // Short-circuit logical operators.
  if (op === "&&") return evalNode(node.l, scope, filters) && evalNode(node.r, scope, filters);
  if (op === "||") return evalNode(node.l, scope, filters) || evalNode(node.r, scope, filters);
  if (op === "??") return evalNode(node.l, scope, filters) ?? evalNode(node.r, scope, filters);
  const l = evalNode(node.l, scope, filters) as never;
  const r = evalNode(node.r, scope, filters) as never;
  switch (op) {
    case "+": return (l as number) + (r as number);
    case "-": return l - r;
    case "*": return l * r;
    case "/": return l / r;
    case "%": return l % r;
    case "==": return l == r;
    case "!=": return l != r;
    case "===": return l === r;
    case "!==": return l !== r;
    case "<": return l < r;
    case "<=": return l <= r;
    case ">": return l > r;
    case ">=": return l >= r;
    default: throw new Error(`template: unknown operator '${op}'`);
  }
}

/* ----------------------------- template parser ---------------------------- */

type TplNode =
  | { k: "text"; v: string }
  | { k: "out"; expr: string; raw: boolean }
  | { k: "if"; branches: { cond: string; body: TplNode[] }[]; alt?: TplNode[] }
  | { k: "each"; item: string; index?: string; list: string; body: TplNode[] }
  | { k: "include"; name: string; cond?: string }
  | { k: "set"; name: string; expr: string }
  | { k: "section"; name: string; body: TplNode[] }
  | { k: "yield"; name: string; fallback: TplNode[] }
  | { k: "component"; name: string; props: string; slots: Record<string, TplNode[]>; body: TplNode[] }
  | { k: "dump"; expr: string };

interface ParsedTemplate {
  layout?: string;
  nodes: TplNode[];
}

// Split a template into text / {{ }} / {{{ }}} / {{-- --}} / @tag pieces.
type Piece =
  | { p: "text"; v: string }
  | { p: "out"; expr: string; raw: boolean }
  | { p: "tag"; name: string; arg: string };

function lexTemplate(src: string): Piece[] {
  const pieces: Piece[] = [];
  let i = 0;
  let text = "";
  const flush = () => {
    if (text) pieces.push({ p: "text", v: text });
    text = "";
  };
  while (i < src.length) {
    // Comments {{-- ... --}}
    if (src.startsWith("{{--", i)) {
      const end = src.indexOf("--}}", i + 4);
      i = end === -1 ? src.length : end + 4;
      continue;
    }
    // Raw {{{ ... }}}
    if (src.startsWith("{{{", i)) {
      const end = src.indexOf("}}}", i + 3);
      if (end === -1) throw new Error("template: unclosed {{{");
      flush();
      pieces.push({ p: "out", expr: src.slice(i + 3, end).trim(), raw: true });
      i = end + 3;
      continue;
    }
    // Escaped {{ ... }}
    if (src.startsWith("{{", i)) {
      const end = src.indexOf("}}", i + 2);
      if (end === -1) throw new Error("template: unclosed {{");
      flush();
      pieces.push({ p: "out", expr: src.slice(i + 2, end).trim(), raw: false });
      i = end + 2;
      continue;
    }
    // Tags @name(args) or @name at line level. Require @ not preceded by a word char.
    if (src[i] === "@" && /[a-zA-Z]/.test(src[i + 1] ?? "")) {
      let j = i + 1;
      let name = "";
      while (j < src.length && /[a-zA-Z]/.test(src[j]!)) name += src[j++];
      let arg = "";
      if (src[j] === "(") {
        // balanced-paren capture
        let depth = 0;
        const start = j;
        for (; j < src.length; j++) {
          if (src[j] === "(") depth++;
          else if (src[j] === ")") {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
        }
        arg = src.slice(start + 1, j - 1);
      }
      flush();
      pieces.push({ p: "tag", name, arg });
      i = j;
      continue;
    }
    text += src[i++];
  }
  flush();
  return pieces;
}

const BLOCK_END = new Set(["end", "endif", "endeach", "endfor", "endcomponent", "endsection"]);

function parseTemplate(src: string): ParsedTemplate {
  const pieces = lexTemplate(src);
  let pos = 0;
  let layout: string | undefined;

  function unquote(s: string): string {
    const t = s.trim();
    return t.replace(/^['"]|['"]$/g, "");
  }

  // Parse a run of nodes until a terminator tag (in `stops`) is seen. The
  // terminator is CONSUMED; its name and arg are returned so block parsers can
  // branch (e.g. @elseif's condition, @slot's name). Returns stop=null at EOF.
  function parseNodes(stops: Set<string>): { nodes: TplNode[]; stop: string | null; arg: string } {
    const nodes: TplNode[] = [];
    while (pos < pieces.length) {
      const pc = pieces[pos]!;
      if (pc.p === "text") {
        nodes.push({ k: "text", v: pc.v });
        pos++;
      } else if (pc.p === "out") {
        nodes.push({ k: "out", expr: pc.expr, raw: pc.raw });
        pos++;
      } else {
        // tag
        if (stops.has(pc.name)) {
          pos++;
          return { nodes, stop: pc.name, arg: pc.arg };
        }
        pos++;
        parseTag(pc, nodes);
      }
    }
    return { nodes, stop: null, arg: "" };
  }

  function parseTag(pc: Piece & { p: "tag" }, nodes: TplNode[]): void {
    switch (pc.name) {
      case "layout":
        layout = unquote(pc.arg);
        break;
      case "if": {
        const branches: { cond: string; body: TplNode[] }[] = [];
        let alt: TplNode[] | undefined;
        let cond = pc.arg;
        for (;;) {
          const { nodes: body, stop, arg } = parseNodes(new Set(["elseif", "else", "end", "endif"]));
          branches.push({ cond, body });
          if (stop === "elseif") {
            cond = arg;
            continue;
          }
          if (stop === "else") {
            alt = parseNodes(new Set(["end", "endif"])).nodes;
          }
          break;
        }
        nodes.push({ k: "if", branches, alt });
        break;
      }
      case "each":
      case "for": {
        // @each(item in list) or @each(item, index in list)
        const m = /^\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\s+in\s+([\s\S]+)$/.exec(pc.arg);
        if (!m) throw new Error(`template: malformed @each(${pc.arg})`);
        const { nodes: body } = parseNodes(new Set(["end", "endeach", "endfor"]));
        nodes.push({ k: "each", item: m[1]!, index: m[2], list: m[3]!.trim(), body });
        break;
      }
      case "include":
        nodes.push({ k: "include", name: unquote(splitArgs(pc.arg)[0] ?? "") });
        break;
      case "includeIf": {
        const parts = splitArgs(pc.arg);
        nodes.push({ k: "include", name: unquote(parts[1] ?? ""), cond: parts[0] });
        break;
      }
      case "set": {
        const parts = splitArgs(pc.arg);
        nodes.push({ k: "set", name: unquote(parts[0] ?? ""), expr: parts[1] ?? "null" });
        break;
      }
      case "section": {
        const { nodes: body } = parseNodes(new Set(["end", "endsection"]));
        nodes.push({ k: "section", name: unquote(pc.arg), body });
        break;
      }
      case "yield": {
        // `@yield('name') fallback @end` — the body is default content.
        const { nodes: fallback } = parseNodes(new Set(["end"]));
        nodes.push({ k: "yield", name: unquote(splitArgs(pc.arg)[0] ?? ""), fallback });
        break;
      }
      case "component": {
        const parts = splitArgs(pc.arg);
        const name = unquote(parts[0] ?? "");
        const props = parts.slice(1).join(",") || "{}";
        const slots: Record<string, TplNode[]> = {};
        const body: TplNode[] = [];
        for (;;) {
          const { nodes: run, stop, arg } = parseNodes(new Set(["slot", "end", "endcomponent"]));
          body.push(...run);
          if (stop === "slot") {
            const slotName = unquote(splitArgs(arg)[0] ?? "");
            slots[slotName] = parseNodes(new Set(["end", "endslot"])).nodes;
            continue;
          }
          break;
        }
        nodes.push({ k: "component", name, props, slots, body });
        break;
      }
      case "dump":
        nodes.push({ k: "dump", expr: pc.arg });
        break;
      default:
        if (BLOCK_END.has(pc.name)) throw new Error(`template: unexpected @${pc.name}`);
        throw new Error(`template: unknown tag @${pc.name}`);
    }
  }

  const { nodes } = parseNodes(new Set());
  return { layout, nodes };
}

// Split "a, b, c" respecting quotes, parens, brackets, braces.
function splitArgs(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      cur += c;
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/* ------------------------------- the engine ------------------------------- */

export interface RenderContext {
  sections: Record<string, string>;
  slots: Record<string, string>;
}

export class TemplateEngine {
  private templates = new Map<string, ParsedTemplate>();
  private globals: Record<string, unknown> = {};
  private filters = new Map<string, Filter>();

  constructor() {
    // A few sensible default filters.
    this.filter("upper", (v) => String(v ?? "").toUpperCase());
    this.filter("lower", (v) => String(v ?? "").toLowerCase());
    this.filter("capitalize", (v) => {
      const s = String(v ?? "");
      return s.charAt(0).toUpperCase() + s.slice(1);
    });
    this.filter("json", (v) => JSON.stringify(v));
    this.filter("length", (v) => (v as { length?: number })?.length ?? 0);
  }

  /** Register a template by name from its source string. */
  register(name: string, source: string): this {
    this.templates.set(name, parseTemplate(source));
    return this;
  }

  /** Register many templates at once (e.g. a Node loader reads files and passes them here). */
  registerAll(sources: Record<string, string>): this {
    for (const [name, source] of Object.entries(sources)) this.register(name, source);
    return this;
  }

  /** True if a template is registered. */
  has(name: string): boolean {
    return this.templates.has(name);
  }

  /** Expose a value/function to every template as a global. */
  global(name: string, value: unknown): this {
    this.globals[name] = value;
    return this;
  }

  /** Register a `{{ value | name }}` filter. */
  filter(name: string, fn: Filter): this {
    this.filters.set(name, fn);
    return this;
  }

  /** Render a registered template with the given state. */
  async render(name: string, state: Record<string, unknown> = {}): Promise<string> {
    const tpl = this.templates.get(name);
    if (!tpl) throw new Error(`template: no template named '${name}'`);
    const scope = { ...this.globals, ...state };
    const ctx: RenderContext = { sections: {}, slots: {} };
    const body = await this.renderNodes(tpl.nodes, scope, ctx);

    if (tpl.layout) {
      const layoutTpl = this.templates.get(tpl.layout);
      if (!layoutTpl) throw new Error(`template: no layout named '${tpl.layout}'`);
      // Child's sections (collected during its render) are available to @yield.
      return this.renderNodes(layoutTpl.nodes, scope, { sections: ctx.sections, slots: {} });
    }
    return body;
  }

  private ev(expr: string, scope: Record<string, unknown>): unknown {
    return evalNode(compileExpr(expr), scope, this.filters);
  }

  private async renderNodes(
    nodes: TplNode[],
    scope: Record<string, unknown>,
    ctx: RenderContext,
  ): Promise<string> {
    let out = "";
    for (const node of nodes) {
      out += await this.renderNode(node, scope, ctx);
    }
    return out;
  }

  private async renderNode(
    node: TplNode,
    scope: Record<string, unknown>,
    ctx: RenderContext,
  ): Promise<string> {
    switch (node.k) {
      case "text":
        return node.v;
      case "out": {
        const v = this.ev(node.expr, scope);
        if (v == null) return "";
        return node.raw ? String(v) : escapeHtml(v);
      }
      case "if": {
        for (const b of node.branches) {
          if (this.ev(b.cond, scope)) return this.renderNodes(b.body, scope, ctx);
        }
        return node.alt ? this.renderNodes(node.alt, scope, ctx) : "";
      }
      case "each": {
        const list = this.ev(node.list, scope) as unknown[];
        if (list == null) return "";
        const items = Array.isArray(list) ? list : Object.values(list);
        let out = "";
        for (let idx = 0; idx < items.length; idx++) {
          const child: Record<string, unknown> = { ...scope };
          child[node.item] = items[idx];
          if (node.index) child[node.index] = idx;
          child["$loop"] = {
            index: idx,
            iteration: idx + 1,
            first: idx === 0,
            last: idx === items.length - 1,
            count: items.length,
            even: idx % 2 === 1,
            odd: idx % 2 === 0,
          };
          out += await this.renderNodes(node.body, child, ctx);
        }
        return out;
      }
      case "set": {
        scope[node.name] = this.ev(node.expr, scope);
        return "";
      }
      case "include": {
        if (node.cond && !this.ev(node.cond, scope)) return "";
        const inc = this.templates.get(node.name);
        if (!inc) throw new Error(`template: no template named '${node.name}' (include)`);
        return this.renderNodes(inc.nodes, scope, ctx);
      }
      case "section": {
        ctx.sections[node.name] = await this.renderNodes(node.body, scope, ctx);
        return "";
      }
      case "yield": {
        const provided = ctx.sections[node.name];
        if (provided !== undefined) return provided;
        return this.renderNodes(node.fallback, scope, ctx);
      }
      case "component": {
        const comp = this.templates.get(node.name);
        if (!comp) throw new Error(`template: no component named '${node.name}'`);
        const props = (this.ev(node.props, scope) as Record<string, unknown>) ?? {};
        // Render slots against the *caller's* scope.
        const slots: Record<string, string> = {};
        slots["main"] = await this.renderNodes(node.body, scope, ctx);
        for (const [sname, sbody] of Object.entries(node.slots)) {
          slots[sname] = await this.renderNodes(sbody, scope, ctx);
        }
        const compScope = { ...this.globals, ...props, slots };
        return this.renderNodes(comp.nodes, compScope, { sections: {}, slots });
      }
      case "dump": {
        const v = this.ev(node.expr, scope);
        return `<pre>${escapeHtml(JSON.stringify(v, null, 2))}</pre>`;
      }
    }
  }
}

/* -------------------------------- global ---------------------------------- */

let engine = new TemplateEngine();

/** The default template engine (register templates/globals/filters on it). */
export function templates(): TemplateEngine {
  return engine;
}

/** Replace the default template engine. */
export function setTemplateEngine(e: TemplateEngine): TemplateEngine {
  engine = e;
  return engine;
}

/** Render a registered template on the default engine. */
export function render(name: string, state?: Record<string, unknown>): Promise<string> {
  return engine.render(name, state);
}
