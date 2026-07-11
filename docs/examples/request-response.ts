// Type-check harness for docs/request-response.md. Every type-checkable snippet
// in the reference is exercised here against the real exports, so a renamed
// accessor or wrong argument type fails `npm run typecheck:docs`. Compile-only —
// never executed. These accessors read an ambient request context, so the calls
// only need to type-check, not run.
import {
  ctx,
  json,
  text,
  html,
  redirect,
  request,
  response,
  param,
  query,
  header,
  body,
} from "@shaferllc/keel/core";

declare const created: unknown;
declare const rows: unknown;
declare const csv: string;
declare const token: string;
declare const data: unknown;
declare const user: { isAdmin: boolean } | undefined;
declare function next(): Promise<void>;
declare function log(path: string): void;
declare function highlightNav(): void;
declare function store(bytes: ArrayBuffer): Promise<void>;

export async function readingInput() {
  request.param("id");
  request.query("q");
  request.header("authorization");

  await request.all();
  await request.input("email");
  const page = await request.input("page", 1); // number
  await request.only(["email", "name"]);
  await request.except(["password"]);

  const body1 = await request.json<{ email: string }>();

  // Raw body accessors for other content types.
  const asText: string = await request.text();
  const asBytes: ArrayBuffer = await request.arrayBuffer();
  const asBlob: Blob = await request.blob();

  return { page, body1, asText, asBytes, asBlob };
}

export function requestMeta() {
  const method: string = request.method;
  const path: string = request.path;
  const url: string = request.url;
  const status: number = request.status;
  const raw: Request = request.raw;
  const hasBody: boolean = request.hasBody();
  const headers: Record<string, string> = request.headers();
  const ip: string | undefined = request.ip();
  const ips: string[] = request.ips();
  return { method, path, url, status, raw, hasBody, headers, ip, ips };
}

export async function middleware() {
  await next();
  if (request.status >= 500) log(request.path);
}

export function routeInfo() {
  request.route;
  const named: boolean = request.routeIs("users.show");
  const tenant: string | undefined = request.subdomain("tenant");
  if (request.routeIs("users.show")) highlightNav();
  return { named, tenant };
}

export function cookiesRead() {
  request.cookie("session");
  request.cookie();
}

export async function fileUploads() {
  const avatar = await request.file("avatar"); // File | undefined
  const docs = await request.files("docs"); // File[]
  const all = await request.allFiles(); // { field: File | File[] }

  if (avatar) {
    avatar.name;
    avatar.size;
    avatar.type;
    const bytes = await avatar.arrayBuffer();
    await store(bytes);
  }
  return { docs, all };
}

export function negotiation() {
  const best: string | null = request.accepts([
    "application/json",
    "text/html",
  ]);
  const types: string[] = request.types();
  const lang: string | null = request.language(["en", "fr"]);
  const langs: string[] = request.languages();
  return { best, types, lang, langs };
}

export function negotiateSwitch(): Response {
  switch (request.accepts(["application/json", "text/html"])) {
    case "application/json":
      return json(created);
    case "text/html":
      return html("<p>ok</p>");
    default:
      return response.abort("Not acceptable", 406);
  }
}

export function responseBuilders() {
  ctx().req.raw;

  json({ ok: true });
  json({ error: "nope" }, 422);
  text("pong");
  text("rate limited", 429);
  html("<h1>Hi</h1>");
  redirect("/login");
  redirect("/", 301);
}

export function writingOutput() {
  response.json({ ok: true });
  response.text("hello");
  response.html("<h1>Hi</h1>");
  response.redirect("/login");
  response.send(data);

  response.status(201).json(created);
  response.header("x-total", "42").json(rows);
  response.headers({ "x-total": "42", "cache-control": "no-store" });
  const ct: string | null = response.getHeader("content-type");
  const has: boolean = response.hasHeader("cache-control");
  void ct;
  void has;
  response.type("text/csv").append("vary", "accept");
  response.removeHeader("x-powered-by");
  response.cookie("flash", "saved").redirect("/");

  response.cookie("session", token, { httpOnly: true, maxAge: 3600 });
  response.clearCookie("session");

  response.status(202).json({ queued: true });
  response.type("text/csv").send(csv);
  response.append("vary", "accept").append("vary", "accept-language");
  response.send({ ok: true });
  response.send("pong");
}

export function guards() {
  response.abort("Not found", 404);
}

export function conditionalGuards() {
  response.abortIf(!user, "Not found", 404);
  response.abortUnless(user?.isAdmin, "Forbidden", 403);
}

export async function standaloneShortcuts() {
  const id: string = param("id");
  const allParams: Record<string, string> = param();
  const q: string | undefined = query("q");
  const allQuery: Record<string, string> = query();
  const auth: string | undefined = header("authorization");
  const payload = await body<{ email: string }>();
  return { id, allParams, q, allQuery, auth, payload };
}
