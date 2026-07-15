/**
 * Keel Watch — the dashboard SPA. A small Preact app that polls the JSON API and
 * renders it: a tab per entry type, a master list, and a detail pane that links a
 * request to everything it produced. No router library — the URL hash is the
 * whole of the navigation state.
 */

import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import "./watch.css";

type EntryType = string;

interface Entry {
  uuid: string;
  batchId: string;
  type: EntryType;
  familyHash?: string;
  content: Record<string, unknown>;
  tags: string[];
  createdAt: number;
}

interface Boot {
  base: string;
  api: string;
  types: EntryType[];
}

const boot: Boot = (window as unknown as { __WATCH__: Boot }).__WATCH__;

const LABELS: Record<string, string> = {
  request: "Requests",
  query: "Queries",
  exception: "Exceptions",
  log: "Logs",
  mail: "Mail",
  job: "Jobs",
  notification: "Notifications",
  cache: "Cache",
  event: "Events",
  schedule: "Schedule",
};

/* --------------------------------- api ------------------------------------ */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${boot.api}${path}`, init);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

/* ------------------------------- hash route ------------------------------- */

interface Route {
  type: EntryType;
  uuid?: string;
  tag?: string;
}

function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [seg, value] = raw.split("/");
  if (seg === "entry" && value) return { type: currentType(), uuid: value };
  if (seg === "failed-jobs") return { type: "failed-jobs" };
  const [type, tagPart] = raw.split("?");
  const tag = new URLSearchParams(tagPart ?? "").get("tag") ?? undefined;
  return { type: type || boot.types[0]!, ...(tag ? { tag } : {}) };
}

let _lastType = boot.types[0]!;
function currentType(): EntryType {
  return _lastType;
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  if (route.type) _lastType = route.type;
  return route;
}

function go(type: EntryType, tag?: string): void {
  location.hash = `#/${type}${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
}
function openEntry(uuid: string): void {
  location.hash = `#/entry/${uuid}`;
}

/* ------------------------------ summaries --------------------------------- */

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function summarize(e: Entry): string {
  const c = e.content;
  switch (e.type) {
    case "request":
      return `${str(c.method)} ${str(c.path)} → ${str(c.status)}`;
    case "query":
      return str(c.sql);
    case "exception":
      return `${str(c.class)}: ${str(c.message)}`;
    case "log":
      return `[${str(c.level)}] ${str(c.message)}`;
    case "mail":
      return `${str(c.subject)} → ${str(c.to)}`;
    case "job":
      return `${str(c.job)} · ${str(c.status)}`;
    case "notification":
      return `${str(c.notification)} → ${(c.channels as string[] | undefined)?.join(", ") ?? ""}`;
    case "cache":
      return `${c.hit ? "hit" : "miss"} ${str(c.key)}`;
    case "event":
      return str(c.name);
    case "schedule":
      return str(c.task);
    default:
      return e.type;
  }
}

function meta(e: Entry): string {
  const c = e.content;
  if (c.durationMs != null) return `${c.durationMs} ms`;
  return "";
}

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/* ------------------------------- components ------------------------------- */

function App() {
  const route = useHashRoute();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [live, setLive] = useState(true);

  const refreshCounts = () => api<{ counts: Record<string, number> }>("/counts").then((r) => setCounts(r.counts)).catch(() => {});

  useEffect(() => {
    refreshCounts();
    if (!live) return;
    const id = setInterval(refreshCounts, 3000);
    return () => clearInterval(id);
  }, [live]);

  const clearAll = async () => {
    if (!confirm("Delete all recorded entries?")) return;
    await api("/entries", { method: "DELETE" }).catch(() => {});
    refreshCounts();
    // force the list to reload
    location.hash = `#/${route.type}?_=${Date.now()}`;
  };

  return (
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <span class="anchor">⚓</span> Keel Watch
        </div>
        <nav>
          {boot.types.map((t) => (
            <button
              key={t}
              class={`tab ${route.type === t && !route.uuid ? "active" : ""}`}
              onClick={() => go(t)}
            >
              <span>{LABELS[t] ?? t}</span>
              <span class="count">{counts[t] ?? 0}</span>
            </button>
          ))}
          <button
            class={`tab ${route.type === "failed-jobs" ? "active" : ""}`}
            onClick={() => go("failed-jobs")}
          >
            <span>Failed jobs</span>
          </button>
        </nav>
        <div class="controls">
          <label class="live">
            <input type="checkbox" checked={live} onChange={(e) => setLive((e.target as HTMLInputElement).checked)} />
            Live
          </label>
          <button class="clear" onClick={clearAll}>
            Clear
          </button>
        </div>
      </aside>
      <main class="content">
        {route.uuid ? (
          <Detail uuid={route.uuid} />
        ) : route.type === "failed-jobs" ? (
          <FailedJobs live={live} />
        ) : (
          <List route={route} live={live} />
        )}
      </main>
    </div>
  );
}

function List({ route, live }: { route: Route; live: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const query = useMemo(() => {
    const p = new URLSearchParams({ type: route.type, limit: "100" });
    if (route.tag) p.set("tag", route.tag);
    return p.toString();
  }, [route.type, route.tag]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ entries: Entry[] }>(`/entries?${query}`)
        .then((r) => alive && setEntries(r.entries))
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    setLoading(true);
    load();
    if (!live) return () => (alive = false);
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [query, live]);

  return (
    <>
      <header class="head">
        <h1>{LABELS[route.type] ?? route.type}</h1>
        {route.tag && (
          <button class="chip removable" onClick={() => go(route.type)}>
            {route.tag} ✕
          </button>
        )}
      </header>
      {loading && !entries.length ? (
        <p class="empty">Loading…</p>
      ) : !entries.length ? (
        <p class="empty">No entries yet. Exercise your app and they'll appear here.</p>
      ) : (
        <table class="list">
          <tbody>
            {entries.map((e) => (
              <tr key={e.uuid} onClick={() => openEntry(e.uuid)}>
                <td class="summary">
                  <span class="text">{summarize(e)}</span>
                  <span class="tags">
                    {e.tags.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        class="chip"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          go(route.type, t);
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                </td>
                <td class="metacol">{meta(e)}</td>
                <td class="timecol">{timeAgo(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

interface FailedRow {
  id: string;
  job: string;
  queue: string;
  attempts: number;
  error: string;
  failedAt: number | null;
}

function FailedJobs({ live }: { live: boolean }) {
  const [rows, setRows] = useState<FailedRow[] | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);

  const load = () =>
    api<{ failed: FailedRow[] | null }>("/queue/failed")
      .then((r) => setRows(r.failed))
      .catch(() => {});

  useEffect(() => {
    load();
    if (!live) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [live]);

  const retry = async (id: string) => {
    await api(`/queue/failed/${encodeURIComponent(id)}/retry`, { method: "POST" }).catch(() => {});
    load();
  };
  const remove = async (id: string) => {
    await api(`/queue/failed/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    load();
  };
  const flushAll = async () => {
    if (!confirm("Delete every failed job?")) return;
    await remove("all");
  };

  return (
    <>
      <header class="head">
        <h1>Failed jobs</h1>
        {!!rows?.length && (
          <span class="tags">
            <button class="chip" onClick={() => retry("all")}>
              Retry all
            </button>
            <button class="chip removable" onClick={flushAll}>
              Flush all
            </button>
          </span>
        )}
      </header>
      {rows === undefined ? (
        <p class="empty">Loading…</p>
      ) : rows === null ? (
        <p class="empty">
          The queue driver keeps no failed-job list. Use the database driver (or a driver with a
          `failed` array) to retry from here.
        </p>
      ) : !rows.length ? (
        <p class="empty">Nothing has failed. May it stay that way.</p>
      ) : (
        <table class="list">
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>
                <td class="summary">
                  <span class="text">
                    {f.job} · {f.error.split("\n")[0]}
                  </span>
                  <span class="tags">
                    <span class="chip">{f.queue}</span>
                    <span class="chip">{f.attempts} attempt{f.attempts === 1 ? "" : "s"}</span>
                    <button
                      class="chip"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        retry(f.id);
                      }}
                    >
                      Retry
                    </button>
                    <button
                      class="chip removable"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        remove(f.id);
                      }}
                    >
                      Delete
                    </button>
                  </span>
                  {open === f.id && <pre class="json">{f.error}</pre>}
                </td>
                <td class="timecol">{f.failedAt ? timeAgo(f.failedAt) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Detail({ uuid }: { uuid: string }) {
  const [data, setData] = useState<{ entry: Entry; related: Entry[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null);
    setError(false);
    api<{ entry: Entry; related: Entry[] }>(`/entries/${uuid}`)
      .then(setData)
      .catch(() => setError(true));
  }, [uuid]);

  if (error) return <p class="empty">Entry not found.</p>;
  if (!data) return <p class="empty">Loading…</p>;
  const { entry, related } = data;

  return (
    <>
      <header class="head">
        <button class="back" onClick={() => go(entry.type)}>
          ← {LABELS[entry.type] ?? entry.type}
        </button>
        <h1>{summarize(entry)}</h1>
      </header>
      <div class="tags detailtags">
        {entry.tags.map((t) => (
          <span key={t} class="chip" onClick={() => go(entry.type, t)}>
            {t}
          </span>
        ))}
      </div>
      <pre class="json">{JSON.stringify(entry.content, null, 2)}</pre>
      {related.length > 0 && (
        <section class="related">
          <h2>In the same batch</h2>
          <table class="list">
            <tbody>
              {related.map((e) => (
                <tr key={e.uuid} onClick={() => openEntry(e.uuid)}>
                  <td class="badge">{LABELS[e.type] ?? e.type}</td>
                  <td class="summary">
                    <span class="text">{summarize(e)}</span>
                  </td>
                  <td class="timecol">{meta(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

render(<App />, document.getElementById("app")!);
