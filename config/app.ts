import { env } from "@keel/core";

export default {
  name: env("APP_NAME", "Keel"),
  env: env("APP_ENV", "local"),
  debug: env("APP_DEBUG", true),
  url: env("APP_URL", "http://localhost:3000"),
  port: env("APP_PORT", 3000),
};
