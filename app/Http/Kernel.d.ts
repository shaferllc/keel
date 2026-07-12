import { HttpKernel } from "@keel/core";
import { Application } from "@keel/core";
/**
 * The application's HTTP kernel. Register global middleware here — it runs on
 * every request, in order.
 */
export declare class Kernel extends HttpKernel {
    constructor(app: Application);
}
