# CLAUDE.md

This project's agent guidance lives in **[AGENTS.md](./AGENTS.md)** — read it
first. It covers Keel's conventions, folder layout, how to add each construct,
the commands, and the MCP server.

Quick reminders:

- Start with [`docs/from-install-to-deploy.md`](./docs/from-install-to-deploy.md)
  for create-keeljs → deploy (Cloudflare or optional Keel Cloud).
- Userland imports come from `@shaferllc/keel/core` (this repo's example app uses
  the `@keel/core` tsconfig alias — match the file you're editing).
- Run `npm run typecheck` before finishing; run `npm run build:ai` after editing
  docs or the export surface.
- Prefer `keel make:*` / the MCP `keel_scaffold` tool over hand-writing stubs.
- For deep lookups, connect the MCP server and call `keel_overview`, then
  `keel_search_docs` / `keel_search_api`.
