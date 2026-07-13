import { AuthShell } from "./shell.js";
import { alert, btnSea, field, muted, sectionLabel } from "../ui.js";

interface Props {
  uri: string | null;
  secret: string | null;
  recoveryCodes: string[];
  error: string | null;
}

export default function TwoFactorSetup({ uri, secret, recoveryCodes, error }: Props) {
  return (
    <AuthShell title="Set up two-factor" wide>
      <h1 class="font-display text-2xl font-bold tracking-tight">Set up two-factor</h1>

      {error && <p class={`${alert} mt-5`}>{error}</p>}

      {secret && uri ? (
        <>
          <p class={`${muted} mt-3 text-sm leading-relaxed`}>
            Add this secret to your authenticator app (render a QR from the URI locally — never send
            it to a third-party QR service):
          </p>
          <code class="mt-4 block break-all rounded-lg bg-mist px-3 py-2 font-mono text-sm">
            {secret}
          </code>
          <p class={`${muted} mt-2 break-all text-xs`}>{uri}</p>

          {recoveryCodes.length > 0 && (
            <div class="mt-8">
              <h2 class={sectionLabel}>Recovery codes</h2>
              <p class={`${muted} mt-2 text-sm`}>
                Store these somewhere safe. Each works once if you lose your authenticator.
              </p>
              <ul class="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
                {recoveryCodes.map((code) => (
                  <li class="rounded-md bg-mist px-2 py-1.5">{code}</li>
                ))}
              </ul>
            </div>
          )}

          <form method="post" action="/two-factor/confirm" class="mt-8 flex flex-col gap-3">
            <input
              class={field}
              name="code"
              placeholder="6-digit code"
              inputMode="numeric"
              required
            />
            <button class={btnSea} type="submit">
              Confirm and enable
            </button>
          </form>
        </>
      ) : (
        <a class="mt-6 inline-block text-sm underline underline-offset-2" href="/dashboard">
          Back to dashboard
        </a>
      )}
    </AuthShell>
  );
}
