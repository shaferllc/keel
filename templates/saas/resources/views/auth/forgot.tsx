import Layout from "../layout.js";

export default function Forgot({ sent }: { sent: boolean }) {
  return (
    <Layout title="Reset your password">
      <main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
        <h1 class="text-2xl font-semibold tracking-tight">Reset your password</h1>

        {sent ? (
          // The same answer whether or not that address has an account — otherwise
          // this page tells a stranger which emails are registered.
          <p class="rounded-lg bg-slate-100 px-3 py-2 text-sm">
            If that address has an account, a link is on its way.
          </p>
        ) : (
          <form method="post" action="/forgot-password" class="flex flex-col gap-3">
            <input
              class="rounded-lg border border-slate-300 px-3 py-2"
              type="email"
              name="email"
              placeholder="Email"
              required
            />
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Send the link</button>
          </form>
        )}
      </main>
    </Layout>
  );
}
