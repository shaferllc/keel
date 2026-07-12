/**
 * Application bootstrap. Creates the container, boots providers, registers the
 * HTTP kernel, and loads the route files. Both the server and the console
 * enter through here.
 */
import { Application } from "@keel/core";
export declare function createApplication(): Promise<Application>;
