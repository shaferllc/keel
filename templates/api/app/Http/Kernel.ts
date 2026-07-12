import { HttpKernel } from "@shaferllc/keel/core";
import type { Application } from "@shaferllc/keel/core";

import { requestLogger } from "./Middleware/requestLogger.js";

/** Global middleware — runs on every request, in order. */
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);

    this.use(requestLogger);
  }
}
