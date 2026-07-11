import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MemoryBroadcaster,
  broadcast,
  setBroadcaster,
  channelAuth,
  authorizeChannel,
  clearChannels,
  type Broadcaster,
} from "../src/core/broadcasting.js";

test("memory broadcaster fans out to subscribers", async () => {
  const b = new MemoryBroadcaster();
  const got: unknown[] = [];
  b.subscribe("orders.42", (event, payload, channel) => got.push({ event, payload, channel }));

  await b.publish(["orders.42"], "status", { state: "shipped" });
  assert.deepEqual(got, [{ event: "status", payload: { state: "shipped" }, channel: "orders.42" }]);
});

test("publish reaches every named channel; unrelated channels don't", async () => {
  const b = new MemoryBroadcaster();
  let a = 0;
  let c = 0;
  b.subscribe("a", () => a++);
  b.subscribe("c", () => c++);
  await b.publish(["a", "b"], "e", null);
  assert.equal(a, 1);
  assert.equal(c, 0);
});

test("unsubscribe stops delivery", async () => {
  const b = new MemoryBroadcaster();
  let n = 0;
  const off = b.subscribe("ch", () => n++);
  await b.publish(["ch"], "e", null);
  off();
  await b.publish(["ch"], "e", null);
  assert.equal(n, 1);
});

test("global broadcast() uses the registered broadcaster", async () => {
  const seen: { channels: string[]; event: string; payload: unknown }[] = [];
  const custom: Broadcaster = {
    async publish(channels, event, payload) {
      seen.push({ channels, event, payload });
    },
  };
  setBroadcaster(custom);
  await broadcast("room.1", "message", { text: "hi" });
  await broadcast(["a", "b"], "ping");
  assert.deepEqual(seen[0], { channels: ["room.1"], event: "message", payload: { text: "hi" } });
  assert.deepEqual(seen[1], { channels: ["a", "b"], event: "ping", payload: undefined });
});

test("a channel with no rule is public (authorized)", async () => {
  clearChannels();
  assert.equal(await authorizeChannel("news", { id: 1 }), true);
});

test("channelAuth gates private channels and extracts params", async () => {
  clearChannels();
  channelAuth("orders.{orderId}", (user, params) => {
    return (user as { id: number }).id === Number(params.orderId);
  });

  assert.equal(await authorizeChannel("orders.42", { id: 42 }), true); // owner
  assert.equal(await authorizeChannel("orders.42", { id: 7 }), false); // not owner
});

test("presence channels return member data", async () => {
  clearChannels();
  channelAuth("presence.room.{room}", (user, params) => {
    const u = user as { id: number; name: string };
    return { id: u.id, name: u.name, room: params.room };
  });
  const member = await authorizeChannel("presence.room.lobby", { id: 1, name: "Ada" });
  assert.deepEqual(member, { id: 1, name: "Ada", room: "lobby" });
});

test("the first matching rule wins; async authorizers work", async () => {
  clearChannels();
  channelAuth("chat.{id}", async (user) => Boolean(user));
  assert.equal(await authorizeChannel("chat.9", { id: 1 }), true);
  assert.equal(await authorizeChannel("chat.9", null), false);
});
