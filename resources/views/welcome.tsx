// @jsxRuntime automatic
// @jsxImportSource hono/jsx
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

/** The welcome page — rendered by HomeController@welcome. */
export const WelcomePage: FC<{ appName: string }> = ({ appName }) => (
  <Layout title={`${appName} ⚓`}>
    <h1>⚓ {appName}</h1>
    <p>
      Your view is rendering. This page is a Hono JSX component in{" "}
      <code>resources/views/</code>, rendered through Keel's{" "}
      <code>View</code> service.
    </p>
    <p>
      Edit <code>resources/views/welcome.tsx</code> and refresh.
    </p>
  </Layout>
);
