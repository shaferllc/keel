/**
 * Keel Cloud MCP tools — registered only when KEEL_CLOUD_TOKEN is set.
 *
 * Talks to a Keel Cloud control plane over HTTP (Bearer token). Agents use these
 * to create sites, preview/publish, manage secrets/domains/billing, and export
 * without leaving the IDE.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const PRESETS = ["minimal", "api", "app", "saas"] as const;

function cloudConfig(): { url: string; token: string } | null {
  const token = String(process.env.KEEL_CLOUD_TOKEN ?? "").trim();
  if (!token) return null;
  const url = String(process.env.KEEL_CLOUD_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return { url, token };
}

async function cloudFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const cfg = cloudConfig();
  if (!cfg) throw new Error("KEEL_CLOUD_TOKEN is not set");

  const response = await fetch(`${cfg.url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { ok: response.ok, status: response.status, body };
}

function jsonText(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function requireConfirm(confirm: boolean, action: string) {
  if (confirm) return null;
  return jsonText(
    {
      error: `${action} requires confirm=true. Ask the user to confirm before calling again.`,
    },
    true,
  );
}

/** Register Cloud tools on an existing MCP server when a Cloud token is present. */
export function registerCloudTools(server: McpServer): boolean {
  if (!cloudConfig()) return false;

  server.registerTool(
    "keel_cloud_me",
    {
      title: "Keel Cloud — who am I",
      description:
        "Return the Keel Cloud user authenticated by KEEL_CLOUD_TOKEN (plan, site_limit, team_id). Token binds to the user's first team.",
      inputSchema: {},
    },
    async () => {
      const res = await cloudFetch("/api/v1/me");
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_billing",
    {
      title: "Keel Cloud — billing status",
      description:
        "Current team plan (free|pro), site limits, custom-domain eligibility, and whether the caller is the owner.",
      inputSchema: {},
    },
    async () => {
      const res = await cloudFetch("/api/v1/billing");
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_billing_checkout",
    {
      title: "Keel Cloud — Stripe checkout URL",
      description:
        "Create a Stripe Checkout session for Keel Cloud Pro (owner only). Return the url for the user to open — do not scrape cards.",
      inputSchema: {},
    },
    async () => {
      const res = await cloudFetch("/api/v1/billing/checkout", { method: "POST", body: "{}" });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_billing_portal",
    {
      title: "Keel Cloud — Stripe customer portal URL",
      description:
        "Open the Stripe customer portal URL for the team (owner only) to update card / cancel. Return the url for the user.",
      inputSchema: {},
    },
    async () => {
      const res = await cloudFetch("/api/v1/billing/portal", { method: "POST", body: "{}" });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_list_sites",
    {
      title: "Keel Cloud — list sites",
      description:
        "List sites on the current Keel Cloud team. Includes storage_path for local editing and hostnames.",
      inputSchema: {},
    },
    async () => {
      const res = await cloudFetch("/api/v1/sites");
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_get_site",
    {
      title: "Keel Cloud — get site",
      description: "Fetch one Keel Cloud site by id (paths, hostnames, status, git).",
      inputSchema: {
        site_id: z.number().int().describe("Site id from keel_cloud_list_sites"),
      },
    },
    async ({ site_id }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}`);
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_create_site",
    {
      title: "Keel Cloud — create site",
      description:
        "Create a new Keel Cloud site from a preset (minimal|api|app|saas). Scaffolds source under storage/sites/{slug} and returns storage_path for editing.",
      inputSchema: {
        name: z.string().min(1).describe("Human-readable site name"),
        preset: z.enum(PRESETS).optional().describe("Keel preset (default minimal)"),
      },
    },
    async ({ name, preset }) => {
      const res = await cloudFetch("/api/v1/sites", {
        method: "POST",
        body: JSON.stringify({ name, preset: preset ?? "minimal" }),
      });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_delete_site",
    {
      title: "Keel Cloud — soft-delete site",
      description:
        "Soft-delete a site (detaches hostnames; recoverable within retention). Requires confirm=true.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
        confirm: z.boolean().describe("Must be true — ask the user before setting this"),
      },
    },
    async ({ site_id, confirm }) => {
      const blocked = requireConfirm(confirm, "Delete");
      if (blocked) return blocked;
      const res = await cloudFetch(`/api/v1/sites/${site_id}/delete`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_restore_site",
    {
      title: "Keel Cloud — restore soft-deleted site",
      description: "Restore a soft-deleted site within the retention window. Redeploy to reattach hostnames.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
      },
    },
    async ({ site_id }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}/restore`, {
        method: "POST",
        body: "{}",
      });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_preview",
    {
      title: "Keel Cloud — deploy preview",
      description:
        "Deploy the site's preview Worker (and attach preview hostname when Cloudflare is configured). Safe to call freely while iterating.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
      },
    },
    async ({ site_id }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}/preview`, { method: "POST", body: "{}" });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_publish",
    {
      title: "Keel Cloud — publish production",
      description:
        "Publish the site to its production Worker/hostname. Requires confirm=true (explicit user approval).",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
        confirm: z
          .boolean()
          .describe("Must be true to publish — ask the user before setting this"),
      },
    },
    async ({ site_id, confirm }) => {
      const blocked = requireConfirm(confirm, "Publish");
      if (blocked) return blocked;
      const res = await cloudFetch(`/api/v1/sites/${site_id}/publish`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_deploys",
    {
      title: "Keel Cloud — deploy history",
      description: "List recent preview/production deploys and logs for a site.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
      },
    },
    async ({ site_id }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}/deploys`);
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_list_secrets",
    {
      title: "Keel Cloud — list secret keys",
      description: "List vault key names for a site (values are never returned).",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
      },
    },
    async ({ site_id }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}/secrets`);
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_set_secret",
    {
      title: "Keel Cloud — set secret",
      description:
        "Store a secret in the site vault (never in git). Injected into the Worker on the next preview/publish.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
        key: z.string().min(1).describe("Env-style key, e.g. STRIPE_SECRET_KEY"),
        value: z.string().describe("Secret value (will not be echoed by the dashboard)"),
      },
    },
    async ({ site_id, key, value }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}/secrets`, {
        method: "PUT",
        body: JSON.stringify({ key, value }),
      });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_delete_secret",
    {
      title: "Keel Cloud — delete secret",
      description: "Remove a secret key from the site vault.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
        key: z.string().min(1).describe("Secret key to remove"),
      },
    },
    async ({ site_id, key }) => {
      const res = await cloudFetch(
        `/api/v1/sites/${site_id}/secrets?key=${encodeURIComponent(key)}`,
        { method: "DELETE" },
      );
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_set_custom_domain",
    {
      title: "Keel Cloud — set custom domain",
      description:
        "Set a Pro custom hostname (CNAME instructions returned). Optionally attach=true to verify DNS and attach to the production Worker.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
        hostname: z.string().min(1).describe("Customer hostname, e.g. app.example.com"),
        attach: z
          .boolean()
          .optional()
          .describe("If true, verify DNS and attach Workers Custom Domain now"),
      },
    },
    async ({ site_id, hostname, attach }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}/custom-domain`, {
        method: "PUT",
        body: JSON.stringify({ hostname, attach: Boolean(attach) }),
      });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_clear_custom_domain",
    {
      title: "Keel Cloud — clear custom domain",
      description: "Detach and clear the site's custom hostname (Pro).",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
      },
    },
    async ({ site_id }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}/custom-domain`, { method: "DELETE" });
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_export",
    {
      title: "Keel Cloud — export manifest",
      description:
        "Return the site's export manifest (paths, hostnames, Keel version, SQL dump URLs). Use storage_path / git_url for code; use keel_cloud_export_sql for data.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
      },
    },
    async ({ site_id }) => {
      const res = await cloudFetch(`/api/v1/sites/${site_id}/export`);
      return jsonText(res.body, !res.ok);
    },
  );

  server.registerTool(
    "keel_cloud_export_sql",
    {
      title: "Keel Cloud — export SQL dump",
      description:
        "Download a portable .sql dump for local sqlite, preview D1, or production D1. Prefer production after publish for a full escape hatch.",
      inputSchema: {
        site_id: z.number().int().describe("Site id"),
        env: z
          .enum(["local", "preview", "production"])
          .optional()
          .describe("Which database to dump (default local)"),
      },
    },
    async ({ site_id, env }) => {
      const environment = env ?? "local";
      const res = await cloudFetch(`/api/v1/sites/${site_id}/export/sql?env=${environment}`);
      if (!res.ok) return jsonText(res.body, true);
      const sql = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
      return jsonText({
        site_id,
        env: environment,
        sql,
        hint: "Write this to a .sql file and restore with sqlite3 / D1 import on a real Keel app.",
      });
    },
  );

  return true;
}
