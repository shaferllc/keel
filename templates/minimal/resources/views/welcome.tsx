import Layout from "./layout.js";

export default function Welcome({ name }: { name: string }) {
  return (
    <Layout title="Keel">
      <main class="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
        <h1 class="text-4xl font-semibold tracking-tight">Hello, {name}.</h1>
        <p class="text-slate-600">
          This is a JSX view, rendered on the server. Edit{" "}
          <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">resources/views/welcome.tsx</code>.
        </p>
      </main>
    </Layout>
  );
}
