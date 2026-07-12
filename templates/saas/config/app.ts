import { env } from "@shaferllc/keel/core";

export default {
  name: env("APP_NAME", "Keel App"),
  env: env("APP_ENV", "local"),
  debug: env("APP_DEBUG", true),
  url: env("APP_URL", "http://localhost:3000"),
  port: env("APP_PORT", 3000),
  key: env("APP_KEY", ""),
};
