/**
 * Pick a free TCP port, starting at `preferred` and walking up.
 *
 * Used by `keel serve` so a leftover process on :3000 doesn't kill `npm run
 * dev` — the common Vite/Next habit. The probe is best-effort (TOCTOU with the
 * real listen), so callers still attach an `error` handler on the server.
 */
import { createServer } from "node:net";

const SCAN = 50;

export async function findAvailablePort(preferred: number): Promise<number> {
  if (!Number.isInteger(preferred) || preferred < 0) {
    throw new Error(`Invalid port: ${preferred}`);
  }

  const last = preferred + SCAN;
  for (let port = preferred; port <= last; port++) {
    if (await canBind(port)) return port;
  }

  throw new Error(`No free port in ${preferred}–${last}`);
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // Match @hono/node-server's default: omit host so Node dual-stacks like
    // `listen(port)` does for the real server (the EADDRINUSE we saw was :::3000).
    const server = createServer();
    server.unref();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(false);
      else reject(err);
    });
    server.listen(port, () => {
      server.close((closeErr) => (closeErr ? reject(closeErr) : resolve(true)));
    });
  });
}
