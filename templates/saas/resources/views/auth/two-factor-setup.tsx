import { Alert, Button, Field, Muted, SectionLabel } from "@shaferllc/keel/ui";
import { AuthShell } from "./shell.js";

interface Props {
  qr: string | null;
  uri: string | null;
  secret: string | null;
  recoveryCodes: string[];
  error: string | null;
}

export default function TwoFactorSetup({ qr, uri, secret, recoveryCodes, error }: Props) {
  const ready = Boolean(secret && uri && qr);

  return (
    <AuthShell title="Set up two-factor" wide>
      <h1 class="font-display text-2xl font-bold tracking-tight">Set up two-factor</h1>

      {error && <Alert class="mt-5">{error}</Alert>}

      {ready ? (
        <>
          <Muted class="mt-3 text-sm leading-relaxed">
            Scan this with your authenticator app. The code is rendered here — it never leaves this
            server.
          </Muted>

          <div class="mt-6 flex justify-center">
            <img
              src={qr!}
              alt="Authenticator QR code"
              width="200"
              height="200"
              class="rounded-xl border border-line bg-white p-3"
            />
          </div>

          <Muted class="mt-6 text-sm">Or enter this secret manually:</Muted>
          <code class="mt-2 block break-all rounded-lg bg-mist px-3 py-2 font-mono text-sm">
            {secret}
          </code>

          {recoveryCodes.length > 0 && (
            <div class="mt-8">
              <SectionLabel>Recovery codes</SectionLabel>
              <Muted class="mt-2 text-sm">
                Store these somewhere safe. Each works once if you lose your authenticator.
              </Muted>
              <ul class="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
                {recoveryCodes.map((code) => (
                  <li class="rounded-md bg-mist px-2 py-1.5">{code}</li>
                ))}
              </ul>
            </div>
          )}

          <form method="post" action="/two-factor/confirm" class="mt-8 flex flex-col gap-3">
            <Field
              name="code"
              placeholder="6-digit code"
              inputMode="numeric"
              autocomplete="one-time-code"
              required
            />
            <Button variant="sea" type="submit">
              Confirm and enable
            </Button>
          </form>
        </>
      ) : (
        <div class="mt-6">
          <Muted class="text-sm">Start two-factor from the dashboard to get a new QR code.</Muted>
          <a class="mt-4 inline-block text-sm underline underline-offset-2" href="/dashboard">
            Back to dashboard
          </a>
        </div>
      )}
    </AuthShell>
  );
}
