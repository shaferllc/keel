// Type-check harness for docs/broadcasting.md. Compile-only — never executed.
import {
  broadcast,
  setBroadcaster,
  getBroadcaster,
  MemoryBroadcaster,
  channelAuth,
  authorizeChannel,
  json,
  request,
  response,
  auth,
  type Broadcaster,
} from "@shaferllc/keel/core";

declare const sha: string;
declare const socket: { send(data: string): void };

type User = { id: number; name: string };

export async function broadcasting() {
  await broadcast("orders.42", "status", { state: "shipped" });
  await broadcast(["team.7", "admins"], "deploy", { sha });
  return getBroadcaster();
}

export function channels() {
  channelAuth("orders.{orderId}", (user, params) => (user as User).id === Number(params.orderId));
  channelAuth("presence.room.{room}", (user, params) => {
    const u = user as User;
    return { id: u.id, name: u.name, room: params.room };
  });
}

export async function authEndpoint() {
  const { channel } = (await request.all()) as { channel: string };
  const ok = await authorizeChannel(channel, await auth().user());
  if (!ok) response.abort("Forbidden", 403);
  return json(ok);
}

export function fanOut() {
  const bus = new MemoryBroadcaster();
  setBroadcaster(bus);
  const off = bus.subscribe("orders.42", (event, payload) =>
    socket.send(JSON.stringify({ event, payload })),
  );
  off();
}

// A Pusher-style fetch driver
export const pusher = (url: string, authorization: string): Broadcaster => ({
  async publish(channels, event, payload) {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({ channels, name: event, data: JSON.stringify(payload) }),
    });
  },
});
