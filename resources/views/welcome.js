import { jsxs as _jsxs, jsx as _jsx } from "hono/jsx/jsx-runtime";
import { Layout } from "./layout.js";
/** The welcome page — rendered by HomeController@welcome. */
export const WelcomePage = ({ appName }) => (_jsxs(Layout, { title: `${appName} ⚓`, children: [_jsxs("h1", { children: ["\u2693 ", appName] }), _jsxs("p", { children: ["Your view is rendering. This page is a Hono JSX component in", " ", _jsx("code", { children: "resources/views/" }), ", rendered through Keel's", " ", _jsx("code", { children: "View" }), " service."] }), _jsxs("p", { children: ["Edit ", _jsx("code", { children: "resources/views/welcome.tsx" }), " and refresh."] })] }));
