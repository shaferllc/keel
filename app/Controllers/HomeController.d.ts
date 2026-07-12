import type { Ctx } from "@keel/core";
export declare class HomeController {
    index(c: Ctx): Response & import("hono").TypedResponse<{
        framework: string;
        app: any;
        env: any;
        message: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">;
    /** Render a view in one call. */
    welcome(c: Ctx): Promise<string>;
    show(): Response;
    clock(): Response;
    store(): Promise<Response>;
    /** Throws a semantic 404. */
    missing(c: Ctx): never;
    /** Throws an unexpected error (500). */
    boom(c: Ctx): never;
}
