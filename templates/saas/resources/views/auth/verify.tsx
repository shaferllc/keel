import { Button, Muted } from "@shaferllc/keel/ui";
import { AuthShell } from "./shell.js";

export default function Verify({ ok, email }: { ok: boolean; email: string | null }) {
  return (
    <AuthShell title="Email verification">
      <h1 class="font-display text-2xl font-bold tracking-tight">
        {ok ? "Email confirmed" : "Link expired"}
      </h1>

      {ok ? (
        <Muted class="mt-3 text-sm leading-relaxed">
          {email ?? "Your address"} is verified. You can close this tab and keep using the app.
        </Muted>
      ) : (
        <Muted class="mt-3 text-sm leading-relaxed">
          That verification link is invalid or has expired. Sign in and resend a new one from the
          dashboard.
        </Muted>
      )}

      <Button class="mt-8 w-full" href="/dashboard">
        Dashboard
      </Button>
    </AuthShell>
  );
}
