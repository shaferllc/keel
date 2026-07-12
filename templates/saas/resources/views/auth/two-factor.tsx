import Layout from "../layout.js";

export default function TwoFactor({ error }: { error: string | null }) {
  return (
    <Layout title="Two-factor">
      <main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
        <h1 class="text-2xl font-semibold tracking-tight">Two-factor</h1>

        {error && <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <form method="post" action="/two-factor" class="flex flex-col gap-3">
          <input class="rounded-lg border border-slate-300 px-3 py-2" name="code" placeholder="6-digit code, or a recovery code" required autofocus />
          <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Two-factor</button>
        </form>

        <p class="text-sm text-slate-500">
          Your password was accepted. You are not signed in until this code checks out.
        </p>
      </main>
    </Layout>
  );
}
