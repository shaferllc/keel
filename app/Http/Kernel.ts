import { HttpKernel } from "@keel/core";
import { Application } from "@keel/core";
import { requestLogger } from "./Middleware/requestLogger.js";

/**
 * The application's HTTP kernel. Register global middleware here — it runs on
 * every request, in order.
 */
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(requestLogger);
  }
}
