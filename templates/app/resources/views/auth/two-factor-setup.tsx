import Layout from "../layout.js";

interface Props {
  uri: string | null;
  secret: string | null;
  recoveryCodes: string[];
  error: string | null;
}

export default function TwoFactorSetup({ uri, secret, recoveryCodes, error }: Props) {
  return (
    <Layout title="Set up two-factor">
      <main class="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-12">
        <h1 class="text-2xl font-semibold tracking-tight">Set up two-factor</h1>

        {error && <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {secret && uri ? (
          <>
            <p class="text-sm text-slate-600">
              Add this secret to your authenticator app (render a QR from the URI locally — never
              send it to a third-party QR service):
            </p>
            <code class="block break-all rounded-lg bg-slate-100 px-3 py-2 text-sm">{secret}</code>
            <p class="break-all text-xs text-slate-500">{uri}</p>

            {recoveryCodes.length > 0 && (
              <div>
                <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">
                  Recovery codes
                </h2>
                <p class="mt-1 text-sm text-slate-600">
                  Store these somewhere safe. Each works once if you lose your authenticator.
                </p>
                <ul class="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
                  {recoveryCodes.map((code) => (
                    <li class="rounded bg-slate-100 px-2 py-1">{code}</li>
                  ))}
                </ul>
              </div>
            )}

            <form method="post" action="/two-factor/confirm" class="flex flex-col gap-3">
              <input
                class="rounded-lg border border-slate-300 px-3 py-2"
                name="code"
                placeholder="6-digit code"
                inputMode="numeric"
                required
              />
              <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Confirm and enable</button>
            </form>
          </>
        ) : (
          <a class="text-sm underline" href="/dashboard">
            Back to dashboard
          </a>
        )}
      </main>
    </Layout>
  );
}
