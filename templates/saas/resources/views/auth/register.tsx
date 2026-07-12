import Layout from "../layout.js";

export default function Register({ error }: { error: string | null }) {
  return (
    <Layout title="Register">
      <main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
        <h1 class="text-2xl font-semibold tracking-tight">Register</h1>

        {error && <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <form method="post" action="/register" class="flex flex-col gap-3">
          <input class="rounded-lg border border-slate-300 px-3 py-2" name="name" placeholder="Name" required />
          <input class="rounded-lg border border-slate-300 px-3 py-2" type="email" name="email" placeholder="Email" required />
          <input class="rounded-lg border border-slate-300 px-3 py-2" type="password" name="password" placeholder="Password" required />
          <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Register</button>
        </form>

        <p class="text-sm text-slate-500">
          Already have an account? <a class="underline" href="/login">Log in</a>
        </p>
      </main>
    </Layout>
  );
}
