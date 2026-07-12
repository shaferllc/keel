/**
 * `apiResource(router, Model, options)` — a full CRUD REST API from a Keel model,
 * the Remult idea done the Keel way: explicit, server-side, and composed from
 * pieces you already have. It registers real routes (so the OpenAPI package
 * documents them for free), runs writes through the model's mass-assignment guard
 * and your Zod schema, paginates and allow-list-filters reads, and gates every
 * action.
 *
 *   apiResource(router, Post, {
 *     filter: ["status", "authorId"],
 *     sort: ["createdAt", "title"],
 *     body: PostSchema,
 *     access: { read: true, write: (c) => isEditor(c) },
 *     scope: (q) => q.where("deleted", false),
 *   });
 *
 * Access is **deny by default**: an action with no `access` rule returns 403.
 * That's the safe default for a generated API — you opt routes open, never shut.
 */

import type { Router, Ctx } from "../core/http/router.js";
import type { QueryBuilder, Row } from "../core/database.js";
import type { Model } from "../core/model.js";
import type { Schema } from "../core/validation.js";
import { validate } from "../core/validation.js";
import { ForbiddenException, NotFoundException } from "../core/exceptions.js";
import { apiDefaults } from "./config.js";
import { parseListParams, applyListParams } from "./query.js";

/**
 * The route-config key `@shaferllc/keel/openapi` reads operation docs from. It's
 * declared here — not imported from openapi — so this package never depends on
 * openapi: install the two together and routes are documented; install only api
 * and the metadata is inert. Keep this value in sync with openapi's `OPENAPI_KEY`.
 */
const OPENAPI_CONFIG_KEY = "openapi";

/** The slice of an OpenAPI operation this package fills in. */
interface RouteOpenApi {
  summary?: string;
  tags?: string[];
  request?: { body?: Schema<unknown> };
  responses?: Record<string | number, { description?: string }>;
}

/** Wrap operation docs for a route's `.config()`, without importing openapi. */
function openApiConfig(doc: RouteOpenApi): Record<string, unknown> {
  return { [OPENAPI_CONFIG_KEY]: doc };
}

/** A Model subclass (the class itself, with its statics). */
export type ModelStatic = typeof Model;

/** A CRUD action. */
export type ApiAction = "list" | "read" | "create" | "update" | "delete";

/** An access rule: a flat allow/deny, or a per-request predicate. */
export type Access = boolean | ((c: Ctx) => boolean | Promise<boolean>);

/**
 * Access rules per action, with shorthands. Resolution for an action prefers its
 * own key, then the read/write shorthand, then `all`; absent → denied.
 */
export interface ApiAccess {
  /** Fallback for every action. */
  all?: Access;
  /** Shorthand for `list` + `get`. */
  read?: Access;
  /** Shorthand for `create` + `update` + `delete`. */
  write?: Access;
  list?: Access;
  /** The single-item read (GET /:id). */
  get?: Access;
  create?: Access;
  update?: Access;
  delete?: Access;
}

/** How a model is turned into API output — a function, or a Keel Transformer. */
export type ApiTransform =
  | ((model: Model, c: Ctx) => unknown)
  | { item(value: Model): unknown; collection(values: Model[]): unknown[] };

export interface ApiResourceOptions {
  /** Base path. Default: the model's table name. */
  path?: string;
  /** Route-name prefix. Default: the path. */
  name?: string;
  /** Only expose these actions. */
  only?: ApiAction[];
  /** Expose everything except these. */
  except?: ApiAction[];
  /** Columns clients may filter on. Empty = no filtering. */
  filter?: string[];
  /** Columns clients may sort by. Empty = no sorting. */
  sort?: string[];
  /** Default page size (overrides `config("api.perPage")`). */
  perPage?: number;
  /** Max page size (overrides `config("api.maxPerPage")`). */
  maxPerPage?: number;
  /** Zod (or Zod-like) schema validating create + update bodies. */
  body?: Schema<unknown>;
  /** Schema for create only (overrides `body`). */
  createBody?: Schema<unknown>;
  /** Schema for update only (overrides `body`). */
  updateBody?: Schema<unknown>;
  /** Access rules. Deny by default. */
  access?: ApiAccess;
  /**
   * Constrain the base query for **every** row operation — list, read, update,
   * delete. This is row-level security: a row outside the scope reads as 404, so
   * it can't be fetched, changed, or removed.
   */
  scope?: (query: QueryBuilder, c: Ctx) => QueryBuilder | void;
  /** Shape the output. Default: `model.toJSON()`. */
  transform?: ApiTransform;
  /** Mutate the write payload before it's saved (set an owner id, timestamps…). */
  beforeWrite?: (data: Row, c: Ctx, action: "create" | "update") => Row | Promise<Row>;
  /** OpenAPI tags for these routes. Default: `[path]`. */
  tags?: string[];
  /** Singular display name used in generated doc summaries. Default: the model's class name. */
  label?: string;
}

const ALL_ACTIONS: ApiAction[] = ["list", "read", "create", "update", "delete"];

function resolveActions(options: ApiResourceOptions): Set<ApiAction> {
  let actions = options.only ?? ALL_ACTIONS;
  if (options.except) actions = actions.filter((a) => !options.except!.includes(a));
  return new Set(actions);
}

/** Resolve the access rule for an action; undefined (no rule) means deny. */
function ruleFor(access: ApiAccess | undefined, action: ApiAction): Access | undefined {
  const a = access ?? {};
  switch (action) {
    case "list":
      return a.list ?? a.read ?? a.all;
    case "read":
      return a.get ?? a.read ?? a.all;
    case "create":
      return a.create ?? a.write ?? a.all;
    case "update":
      return a.update ?? a.write ?? a.all;
    case "delete":
      return a.delete ?? a.write ?? a.all;
  }
}

/** Evaluate access; throw 403 if denied. */
async function authorize(access: ApiAccess | undefined, action: ApiAction, c: Ctx): Promise<void> {
  const rule = ruleFor(access, action);
  const ok = rule === undefined ? false : typeof rule === "boolean" ? rule : await rule(c);
  if (!ok) throw new ForbiddenException();
}

function transformOne(t: ApiTransform | undefined, model: Model, c: Ctx): unknown {
  if (!t) return model.toJSON();
  return typeof t === "function" ? t(model, c) : t.item(model);
}

function transformMany(t: ApiTransform | undefined, models: Model[], c: Ctx): unknown[] {
  if (!t) return models.map((m) => m.toJSON());
  return typeof t === "function" ? models.map((m) => t(m, c)) : t.collection(models);
}

export function apiResource(
  router: Router,
  model: ModelStatic,
  options: ApiResourceOptions = {},
): void {
  const defaults = apiDefaults();
  const path = options.path ?? model.table;
  const base = "/" + path.replace(/^\/|\/$/g, "");
  const name = options.name ?? path;
  const pk = model.primaryKey;
  const label = options.label ?? model.name;
  const tags = options.tags ?? [path];
  const perPage = options.perPage ?? defaults.perPage;
  const maxPerPage = options.maxPerPage ?? defaults.maxPerPage;
  const actions = resolveActions(options);

  /** The base query with any row-level scope applied. */
  const scoped = (c: Ctx): QueryBuilder => {
    const q = model.query();
    if (!options.scope) return q;
    return options.scope(q, c) ?? q;
  };

  /** Find one row within scope, or 404. */
  const findScoped = async (c: Ctx): Promise<Model> => {
    const row = await scoped(c).where(pk, c.req.param("id")!).first();
    if (!row) throw new NotFoundException(`${model.name} not found`);
    return new model(row);
  };

  const readBody = async (c: Ctx, schema: Schema<unknown> | undefined): Promise<Row> => {
    const raw = (await c.req.json().catch(() => ({}))) as Row;
    return schema ? ((await validate(schema, raw)) as Row) : raw;
  };

  if (actions.has("list")) {
    router
      .get(base, async (c) => {
        await authorize(options.access, "list", c);
        const params = parseListParams(c, {
          filter: options.filter ?? [],
          sort: options.sort ?? [],
          perPage,
          maxPerPage,
        });
        const query = applyListParams(scoped(c), params);
        const result = await query.paginate(params.page, params.perPage);
        const models = result.data.map((row) => new model(row));
        return c.json({
          data: transformMany(options.transform, models, c),
          meta: {
            total: result.total,
            perPage: result.perPage,
            currentPage: result.currentPage,
            lastPage: result.lastPage,
          },
        });
      })
      .name(`${name}.list`)
      .config(openApiConfig({ summary: `List ${path}`, tags }));
  }

  if (actions.has("read")) {
    router
      .get(`${base}/:id`, async (c) => {
        await authorize(options.access, "read", c);
        const found = await findScoped(c);
        return c.json({ data: transformOne(options.transform, found, c) });
      })
      .name(`${name}.read`)
      .config(openApiConfig({ summary: `Fetch ${label}`, tags }));
  }

  if (actions.has("create")) {
    const schema = options.createBody ?? options.body;
    router
      .post(base, async (c) => {
        await authorize(options.access, "create", c);
        let data = await readBody(c, schema);
        if (options.beforeWrite) data = await options.beforeWrite(data, c, "create");
        const created = await model.create(data);
        return c.json({ data: transformOne(options.transform, created, c) }, 201);
      })
      .name(`${name}.create`)
      .config(
        openApiConfig({
          summary: `Create ${label}`,
          tags,
          ...(schema ? { request: { body: schema } } : {}),
          responses: { 201: { description: `The created ${label}` } },
        }),
      );
  }

  if (actions.has("update")) {
    const schema = options.updateBody ?? options.body;
    router
      .route(["PUT", "PATCH"], `${base}/:id`, async (c) => {
        await authorize(options.access, "update", c);
        const found = await findScoped(c);
        let data = await readBody(c, schema);
        if (options.beforeWrite) data = await options.beforeWrite(data, c, "update");
        await found.update(data);
        return c.json({ data: transformOne(options.transform, found, c) });
      })
      .name(`${name}.update`)
      .config(openApiConfig({ summary: `Update ${label}`, tags, ...(schema ? { request: { body: schema } } : {}) }));
  }

  if (actions.has("delete")) {
    router
      .delete(`${base}/:id`, async (c) => {
        await authorize(options.access, "delete", c);
        const found = await findScoped(c);
        await found.delete();
        return c.body(null, 204);
      })
      .name(`${name}.delete`)
      .config(openApiConfig({ summary: `Delete ${label}`, tags, responses: { 204: { description: "Deleted" } } }));
  }
}
