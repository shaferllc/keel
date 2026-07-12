/**
 * The watchers. Each subscribes to one instrumentation seam and turns it into a
 * recorded entry — the whole reason the framework emits those events. None of
 * them patch anything: they're just listeners, so installing Watch changes no
 * behaviour, only observation.
 *
 * `installWatchers` wires up every enabled watcher and hands back a single
 * teardown function (used on shutdown and in tests).
 */

import { listen, events } from "../core/helpers.js";
import { tapLogs, type LogRecord } from "../core/logger.js";
import type {
  RequestEvent,
  QueryEvent,
  ExceptionEvent,
  JobEvent,
  CacheEvent,
  NotificationEvent,
  ScheduleEvent,
} from "../core/instrumentation.js";
import { familyHash, redactHeaders, sqlShape } from "./entry.js";
import type { Recorder } from "./recorder.js";
import type { WatchConfig } from "./config.js";

/** Events the Event watcher ignores — the instrumentation stream and things with
 * their own dedicated watcher, so they aren't recorded twice. */
const OWN_EVENTS = new Set<string>([
  "db.query",
  "request.handled",
  "exception",
  "job.processing",
  "job.processed",
  "job.failed",
  "cache.hit",
  "cache.miss",
  "notification.sent",
  "schedule.task.run",
  "mail.sending",
  "mail.sent",
  "mail.queued",
]);

export function installWatchers(recorder: Recorder, config: WatchConfig): () => void {
  const off: Array<() => void> = [];
  const dash = "/" + config.path.replace(/^\/|\/$/g, "");
  const ignorePath = (path: string): boolean =>
    path === dash ||
    path.startsWith(`${dash}/`) ||
    config.ignorePaths.some((p) => path.startsWith(p));

  /* ------------------------------- requests ------------------------------- */
  if (recorder.enabledFor("request")) {
    off.push(
      listen<RequestEvent>("request.handled", (e) => {
        if (ignorePath(e.path)) return;
        recorder.record(
          "request",
          {
            method: e.method,
            path: e.path,
            status: e.status,
            durationMs: e.durationMs,
            headers: redactHeaders(e.headers),
            ...(e.ip ? { ip: e.ip } : {}),
          },
          [
            `status:${e.status}`,
            `method:${e.method}`,
            e.status >= 500 ? "failed" : e.status >= 400 ? "client-error" : "ok",
          ],
          { batchId: e.id, familyHash: familyHash(`${e.method} ${e.path}`) },
        );
      }),
    );
  }

  /* -------------------------------- queries ------------------------------- */
  if (recorder.enabledFor("query")) {
    off.push(
      listen<QueryEvent>("db.query", (e) => {
        // Never record the store's own reads/writes — that would be a loop.
        if (e.sql.includes(config.table)) return;
        const slow = e.durationMs >= config.slowQueryMs;
        recorder.record(
          "query",
          {
            sql: e.sql,
            bindings: e.bindings,
            durationMs: e.durationMs,
            connection: e.connection,
            kind: e.kind,
          },
          [`connection:${e.connection}`, e.kind, ...(slow ? ["slow"] : [])],
          {
            ...(e.requestId ? { batchId: e.requestId } : {}),
            familyHash: familyHash(sqlShape(e.sql)),
          },
        );
      }),
    );
  }

  /* ------------------------------ exceptions ------------------------------ */
  if (recorder.enabledFor("exception")) {
    off.push(
      listen<ExceptionEvent>("exception", (e) => {
        const err = e.error;
        const cls = err instanceof Error ? err.name : "Error";
        const message = err instanceof Error ? err.message : String(err);
        recorder.record(
          "exception",
          {
            class: cls,
            message,
            status: e.status,
            ...(e.method ? { method: e.method } : {}),
            ...(e.path ? { path: e.path } : {}),
            stack: err instanceof Error ? (err.stack ?? "").split("\n").map((l) => l.trim()) : [],
          },
          [`status:${e.status}`, cls],
          {
            ...(e.requestId ? { batchId: e.requestId } : {}),
            familyHash: familyHash(`${cls}:${message}`),
          },
        );
      }),
    );
  }

  /* --------------------------------- logs --------------------------------- */
  if (recorder.enabledFor("log")) {
    off.push(
      tapLogs((record: LogRecord) => {
        recorder.record(
          "log",
          { level: record.level, message: record.msg, time: record.time, context: record.fields },
          [`level:${record.level}`],
        );
      }),
    );
  }

  /* --------------------------------- mail --------------------------------- */
  if (recorder.enabledFor("mail")) {
    off.push(
      listen<Record<string, unknown>>("mail.sent", (msg) => {
        const m = msg ?? {};
        recorder.record(
          "mail",
          {
            to: m.to,
            from: m.from,
            ...(m.cc ? { cc: m.cc } : {}),
            ...(m.bcc ? { bcc: m.bcc } : {}),
            subject: m.subject,
            ...(typeof m.text === "string" ? { text: m.text } : {}),
            ...(typeof m.html === "string" ? { html: m.html } : {}),
          },
          ["mail:sent"],
        );
      }),
    );
  }

  /* --------------------------------- jobs --------------------------------- */
  if (recorder.enabledFor("job")) {
    off.push(
      listen<JobEvent>("job.processed", (e) => {
        recorder.record(
          "job",
          { job: e.job, status: "processed", ...(e.durationMs != null ? { durationMs: e.durationMs } : {}) },
          ["job:processed", e.job],
          e.requestId ? { batchId: e.requestId } : {},
        );
      }),
    );
    off.push(
      listen<JobEvent>("job.failed", (e) => {
        recorder.record(
          "job",
          { job: e.job, status: "failed", error: e.error },
          ["job:failed", e.job],
          e.requestId ? { batchId: e.requestId } : {},
        );
      }),
    );
  }

  /* ----------------------------- notifications ---------------------------- */
  if (recorder.enabledFor("notification")) {
    off.push(
      listen<NotificationEvent>("notification.sent", (e) => {
        recorder.record(
          "notification",
          { notification: e.notification, channels: e.channels, notifiable: e.notifiable },
          ["notification:sent", ...e.channels.map((c) => `channel:${c}`)],
          e.requestId ? { batchId: e.requestId } : {},
        );
      }),
    );
  }

  /* -------------------------------- cache --------------------------------- */
  if (recorder.enabledFor("cache")) {
    const cacheEntry = (hit: boolean) => (e: CacheEvent) =>
      recorder.record(
        "cache",
        { key: e.key, hit, store: e.store },
        [hit ? "cache:hit" : "cache:miss"],
        e.requestId ? { batchId: e.requestId } : {},
      );
    off.push(listen<CacheEvent>("cache.hit", cacheEntry(true)));
    off.push(listen<CacheEvent>("cache.miss", cacheEntry(false)));
  }

  /* -------------------------------- events -------------------------------- */
  if (recorder.enabledFor("event")) {
    off.push(
      events().onAny((name, payload) => {
        if (OWN_EVENTS.has(name)) return;
        recorder.record("event", { name, payload }, [`event:${name}`]);
      }),
    );
  }

  /* ------------------------------- schedule ------------------------------- */
  if (recorder.enabledFor("schedule")) {
    off.push(
      listen<ScheduleEvent>("schedule.task.run", (e) => {
        recorder.record("schedule", { task: e.task, durationMs: e.durationMs }, [
          "schedule:run",
          e.task,
        ]);
      }),
    );
  }

  return () => {
    for (const unsub of off) unsub();
  };
}
