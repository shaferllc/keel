import Layout from "./layout.js";

export default function Dashboard({ name, twoFactor }: { name: string; twoFactor: boolean }) {
  return (
    <Layout title="Dashboard">
      <main class="mx-auto max-w-2xl px-6 py-16">
        <h1 class="text-3xl font-semibold tracking-tight">Hello, {name}.</h1>

        <p class="mt-4 text-slate-600">
          Two-factor is {twoFactor ? "on" : "off"}.{" "}
          {!twoFactor && "POST /two-factor/enable to start setting it up."}
        </p>

        <form method="post" action="/logout" class="mt-8">
          <button class="rounded-lg border border-slate-300 px-4 py-2">Log out</button>
        </form>
      </main>
    </Layout>
  );
}
