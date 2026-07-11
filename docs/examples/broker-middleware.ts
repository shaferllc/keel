// Type-check harness for the Middlewares section of docs/broker.md.
// Compile-only — never executed.
import { Broker, logger, type BrokerMiddleware } from "@shaferllc/keel/core";

const timing: BrokerMiddleware = {
  name: "timing",
  localAction(next, action) {
    return async (ctx) => {
      const start = performance.now();
      try {
        return await next(ctx);
      } finally {
        logger().debug("action", { action, ms: performance.now() - start });
      }
    };
  },
  started(broker) {
    logger().info("broker up", { nodeID: broker.nodeID });
  },
  stopped() {
    /* flush metrics, close connections */
  },
};

export function withMiddleware(): Broker {
  return new Broker({ middlewares: [timing, { name: "noop" }] });
}
