import Layout from "../layout.js";

export default function Reset({ token, error }: { token: string; error: string | null }) {
  return (
    <Layout title="Choose a new password">
      <main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
        <h1 class="text-2xl font-semibold tracking-tight">Choose a new password</h1>

        {error && <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <form method="post" action="/reset-password" class="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <input
            class="rounded-lg border border-slate-300 px-3 py-2"
            type="password"
            name="password"
            placeholder="New password"
            minLength={8}
            required
          />
          <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Update password</button>
        </form>
      </main>
    </Layout>
  );
}
