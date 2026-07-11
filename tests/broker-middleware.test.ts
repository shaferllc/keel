import { test } from "node:test";
import assert from "node:assert/strict";

import { Broker, type BrokerMiddleware } from "../src/core/broker.js";

test("localAction middleware wraps every action call", async () => {
  const log: string[] = [];
  const trace: BrokerMiddleware = {
    localAction(next, action) {
      return async (ctx) => {
        log.push(`> ${action}`);
        const res = await next(ctx);
        log.push(`< ${action}`);
        return res;
      };
    },
  };

  const b = new Broker({ middlewares: [trace] });
  b.createService({
    name: "math",
    actions: {
      add(ctx: { params: { a: number; b: number } }) {
        log.push("handler");
        return ctx.params.a + ctx.params.b;
      },
    },
  });
  await b.start();

  const sum = await b.call<number>("math.add", { a: 2, b: 3 });
  assert.equal(sum, 5);
  assert.deepEqual(log, ["> math.add", "handler", "< math.add"]);
  await b.stop();
});

test("middlewares compose — first in the array is outermost", async () => {
  const order: string[] = [];
  const mw = (id: string): BrokerMiddleware => ({
    localAction(next) {
      return async (ctx) => {
        order.push(`${id}-in`);
        const r = await next(ctx);
        order.push(`${id}-out`);
        return r;
      };
    },
  });

  const b = new Broker({ middlewares: [mw("a"), mw("b")] });
  b.createService({ name: "s", actions: { go: () => "ok" } });
  await b.start();
  await b.call("s.go");
  assert.deepEqual(order, ["a-in", "b-in", "b-out", "a-out"]);
  await b.stop();
});

test("started / stopped lifecycle hooks fire with the broker", async () => {
  const events: string[] = [];
  const mw: BrokerMiddleware = {
    started(broker) {
      events.push(`started:${broker.nodeID.startsWith("node-")}`);
    },
    stopped() {
      events.push("stopped");
    },
  };
  const b = new Broker({ middlewares: [mw] });
  await b.start();
  await b.stop();
  assert.deepEqual(events, ["started:true", "stopped"]);
});

test("a middleware without localAction leaves calls untouched", async () => {
  const b = new Broker({ middlewares: [{ name: "noop" }] });
  b.createService({ name: "s", actions: { echo: (ctx: { params: unknown }) => ctx.params } });
  await b.start();
  assert.equal(await b.call("s.echo", 42), 42);
  await b.stop();
});
