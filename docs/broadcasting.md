# Broadcasting

Push events to clients in real time over named **channels**. Like the database
and mail layers, broadcasting rides a pluggable `Broadcaster`, so the core owns no
socket — point it at Pusher/Ably (`fetch`), a Cloudflare Durable Object, or the
built-in `MemoryBroadcaster` for tests and single-instance workers.

## Broadcasting an event

```ts
import { broadcast } from "@shaferllc/keel/core";

await broadcast("orders.42", "status", { state: "shipped" });
await broadcast(["team.7", "admins"], "deploy", { sha }); // several channels
```

`broadcast(channels, event, payload)` hands the event to the registered
broadcaster. Register one at boot:

```ts
import { setBroadcaster } from "@shaferllc/keel/core";
setBroadcaster(pusher(env.PUSHER_KEY, env.PUSHER_SECRET));
```

## Channel authorization

Public channels need nothing. **Private** and **presence** channels are gated:
register who may subscribe with `channelAuth`, then have your socket endpoint call
`authorizeChannel`. `{param}` segments are captured from the channel name:

```ts
import { channelAuth, authorizeChannel } from "@shaferllc/keel/core";

// only the order's owner may subscribe:
channelAuth("orders.{orderId}", (user, params) => user.id === Number(params.orderId));

// presence: return member data to join
channelAuth("presence.room.{room}", (user, params) => ({ id: user.id, name: user.name }));
```

At the subscription endpoint (the URL your client hits to authorize a channel):

```ts
router.post("/broadcasting/auth", async () => {
  const { channel } = await request.all();
  const ok = await authorizeChannel(channel, await auth().user());
  if (!ok) response.abort("Forbidden", 403);
  return json(ok); // `true`, or member data for presence
});
```

Return `false` to deny, `true` to allow, or an object of **member data** to allow
*and* join a presence channel. It composes with [`auth()`](./authentication.md)
and [authorization](./authorization.md).

## Same-process fan-out

`MemoryBroadcaster` also lets you `subscribe` in-process — useful inside a
Cloudflare Durable Object (the WebSocket owner) or an SSE loop:

```ts
import { MemoryBroadcaster } from "@shaferllc/keel/core";

const bus = new MemoryBroadcaster();
setBroadcaster(bus);

const off = bus.subscribe("orders.42", (event, payload) => socket.send(JSON.stringify({ event, payload })));
// … later
off();
```

## Writing a driver

A broadcaster is one method — `publish`. Here's the shape for a Pusher-style HTTP
provider over `fetch` (edge-safe):

```ts
import type { Broadcaster } from "@shaferllc/keel/core";

const pusher = (url: string, auth: string): Broadcaster => ({
  async publish(channels, event, payload) {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ channels, name: event, data: JSON.stringify(payload) }),
    });
  },
});
```

For Cloudflare, the driver forwards to a Durable Object that owns the WebSockets;
the DO uses a `MemoryBroadcaster` internally to fan out to its connected sockets.

## API reference

### `broadcast(channels, event, payload?)`

`broadcast(channels: string | string[], event: string, payload?: unknown): Promise<void>`

Publish an event to one or more channels via the registered broadcaster.

### `setBroadcaster(instance)` / `getBroadcaster()`

Register / read the default `Broadcaster`.

### `MemoryBroadcaster`

`class MemoryBroadcaster implements Broadcaster` — in-process pub/sub; the default.
`subscribe(channel, cb)` returns an unsubscribe function.

### `channelAuth(pattern, authorizer)`

`channelAuth(pattern: string, authorizer: (user, params) => boolean | object | Promise<…>): void`

Register an authorizer for a channel pattern. `{param}` segments are captured into
`params`.

### `authorizeChannel(channel, user)`

`authorizeChannel(channel: string, user: unknown): Promise<boolean | Record<string, unknown>>`

Run the first matching rule (a channel with no rule is public → `true`). Returns
`false` (deny), `true` (allow), or member data (presence).

### Interfaces & types

#### `Broadcaster`

`interface Broadcaster { publish(channels: string[], event: string, payload: unknown): Promise<void> }`

#### `ChannelAuthorizer`

`type ChannelAuthorizer = (user: unknown, params: Record<string, string>) => boolean | Record<string, unknown> | Promise<…>`

#### `Subscriber`

`type Subscriber = (event: string, payload: unknown, channel: string) => void`
