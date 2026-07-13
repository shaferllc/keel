import Layout from "./layout.js";

export default function Welcome({ name }: { name: string }) {
  return (
    <Layout title="Keel">
      <main class="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
        <h1 class="text-4xl font-semibold tracking-tight">Hello, {name}.</h1>
        <p class="text-slate-600">
          Minimal Keel starter — routes, a controller, and a JSX view. No database.
          Edit{" "}
          <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">resources/views/welcome.tsx</code>.
        </p>
        <p class="text-sm text-slate-500">
          <a class="underline" href="/health">
            /health
          </a>{" "}
          ·{" "}
          <a class="underline" href="/hello/world">
            /hello/:name
          </a>
        </p>
      </main>
    </Layout>
  );
}
