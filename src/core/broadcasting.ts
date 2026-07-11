/**
 * Broadcasting — push events to clients over named channels, in real time. Like
 * the database and mail layers it's built on a pluggable `Broadcaster`, so the
 * core owns no socket: point it at Pusher/Ably (`fetch`), a Cloudflare Durable
 * Object, or the built-in `MemoryBroadcaster` (in-process fan-out, for tests and
 * single-instance workers).
 *
 *   await broadcast("orders.42", "status", { state: "shipped" });
 *
 * Private and presence channels are gated by `channelAuth` — register who may
 * subscribe, then have your socket endpoint call `authorizeChannel`. It composes
 * with `auth()` and the authorization layer.
 */

/** The bridge to a real-time backend — implement `publish` for your provider. */
export interface Broadcaster {
  publish(channels: string[], event: string, payload: unknown): Promise<void>;
}

/** A same-process subscriber (e.g. a Durable Object or an SSE loop). */
export type Subscriber = (event: string, payload: unknown, channel: string) => void;

/* ---------------------------- memory broadcaster -------------------------- */

/** In-process pub/sub — the default; fans out to local subscribers. Ideal for tests. */
export class MemoryBroadcaster implements Broadcaster {
  private subs = new Map<string, Set<Subscriber>>();

  async publish(channels: string[], event: string, payload: unknown): Promise<void> {
    for (const channel of channels) {
      const set = this.subs.get(channel);
      if (set) for (const cb of set) cb(event, payload, channel);
    }
  }

  /** Listen on a channel; returns an unsubscribe function. */
  subscribe(channel: string, subscriber: Subscriber): () => void {
    const set = this.subs.get(channel) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subs.set(channel, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subs.delete(channel);
    };
  }
}

/* ------------------------------ channel auth ------------------------------ */

/**
 * Decides whether `user` may join a channel. Return `false` to deny, `true` to
 * allow, or an object of member data to allow *and* join a presence channel.
 */
export type ChannelAuthorizer = (
  user: unknown,
  params: Record<string, string>,
) => boolean | Record<string, unknown> | Promise<boolean | Record<string, unknown>>;

interface ChannelRule {
  regex: RegExp;
  keys: string[];
  authorizer: ChannelAuthorizer;
}

const rules: ChannelRule[] = [];

/**
 * Register an authorizer for a channel name pattern. `{param}` segments are
 * captured and handed to the authorizer, e.g. `channelAuth("orders.{id}", …)`.
 */
export function channelAuth(pattern: string, authorizer: ChannelAuthorizer): void {
  const keys: string[] = [];
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{(\w+)\\\}/g, (_, k) => {
    keys.push(k);
    return "([^.]+)";
  });
  rules.push({ regex: new RegExp(`^${source}$`), keys, authorizer });
}

/**
 * Authorize `user` for `channel`. Runs the first matching `channelAuth` rule and
 * returns its result; a channel with no rule is public and returns `true`.
 */
export async function authorizeChannel(
  channel: string,
  user: unknown,
): Promise<boolean | Record<string, unknown>> {
  for (const rule of rules) {
    const match = rule.regex.exec(channel);
    if (!match) continue;
    const params: Record<string, string> = {};
    rule.keys.forEach((key, i) => (params[key] = match[i + 1]!));
    return rule.authorizer(user, params);
  }
  return true; // public channel
}

/** Clear all channel rules (test helper). */
export function clearChannels(): void {
  rules.length = 0;
}

/* -------------------------------- global ---------------------------------- */

let broadcaster: Broadcaster = new MemoryBroadcaster();

/** Register the default broadcaster used by `broadcast()`. */
export function setBroadcaster(instance: Broadcaster): Broadcaster {
  broadcaster = instance;
  return broadcaster;
}

/** The default broadcaster. */
export function getBroadcaster(): Broadcaster {
  return broadcaster;
}

/** Publish an event with a payload to one or more channels. */
export function broadcast(
  channels: string | string[],
  event: string,
  payload?: unknown,
): Promise<void> {
  return broadcaster.publish(Array.isArray(channels) ? channels : [channels], event, payload);
}
