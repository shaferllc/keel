import { Alert, Button, Field, Muted } from "@shaferllc/keel/ui";
import { AuthShell } from "./shell.js";

export default function TwoFactor({ error }: { error: string | null }) {
  return (
    <AuthShell title="Two-factor">
      <h1 class="font-display text-2xl font-bold tracking-tight">Two-factor</h1>
      <Muted class="mt-2 text-sm">
        Your password was accepted. You are not signed in until this code checks out.
      </Muted>

      {error && <Alert class="mt-5">{error}</Alert>}

      <form method="post" action="/two-factor" class="mt-6 flex flex-col gap-3">
        <Field name="code" placeholder="6-digit code, or a recovery code" required autofocus />
        <Button class="mt-1" type="submit">
          Continue
        </Button>
      </form>
    </AuthShell>
  );
}
