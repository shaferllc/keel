import Layout from "./layout.js";

export default function Welcome({ signedIn }: { signedIn: boolean }) {
  return (
    <Layout title="Keel">
      <main class="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
        <h1 class="text-4xl font-semibold tracking-tight">Keel</h1>
        <p class="text-slate-600">Sessions, password reset, and two-factor are already wired.</p>

        <div class="flex gap-3">
          {signedIn ? (
            <a class="rounded-lg bg-slate-900 px-4 py-2 text-white" href="/dashboard">
              Dashboard
            </a>
          ) : (
            <>
              <a class="rounded-lg bg-slate-900 px-4 py-2 text-white" href="/login">
                Log in
              </a>
              <a class="rounded-lg border border-slate-300 px-4 py-2" href="/register">
                Register
              </a>
            </>
          )}
        </div>
      </main>
    </Layout>
  );
}
