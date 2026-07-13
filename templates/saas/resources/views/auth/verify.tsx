import Layout from "../layout.js";

export default function Verify({ ok, email }: { ok: boolean; email: string | null }) {
  return (
    <Layout title="Email verification">
      <main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
        <h1 class="text-2xl font-semibold tracking-tight">
          {ok ? "Email confirmed" : "Link expired"}
        </h1>

        {ok ? (
          <p class="text-slate-600">
            {email ?? "Your address"} is verified. You can close this tab and keep using the app.
          </p>
        ) : (
          <p class="text-slate-600">
            That verification link is invalid or has expired. Sign in and resend a new one from the
            dashboard.
          </p>
        )}

        <a class="rounded-lg bg-slate-900 px-4 py-2 text-center text-white" href="/dashboard">
          Dashboard
        </a>
      </main>
    </Layout>
  );
}
