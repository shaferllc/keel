import { jsx as _jsx, jsxs as _jsxs } from "hono/jsx/jsx-runtime";
/** The base HTML document. Compose pages inside it. */
export const Layout = ({ title, children, }) => (_jsxs("html", { lang: "en", children: [_jsxs("head", { children: [_jsx("meta", { charset: "utf-8" }), _jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }), _jsx("title", { children: title }), _jsx("style", { children: `
        body { font-family: system-ui, sans-serif; margin: 0; background: #0b1120; color: #e2e8f0; }
        main { max-width: 44rem; margin: 0 auto; padding: 4rem 1.5rem; }
        h1 { font-size: 2.25rem; margin: 0 0 .5rem; }
        code { background: #1e293b; padding: .15rem .4rem; border-radius: .3rem; }
      ` })] }), _jsx("body", { children: _jsx("main", { children: children }) })] }));
