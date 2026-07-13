import { Alert, Button, Field, Muted } from "@shaferllc/keel/ui";
import { AuthShell } from "./shell.js";

export default function Reset({ token, error }: { token: string; error: string | null }) {
  return (
    <AuthShell title="Choose a new password">
      <h1 class="font-display text-2xl font-bold tracking-tight">New password</h1>
      <Muted class="mt-2 text-sm">
        Choose something you&apos;ll remember — and haven&apos;t used elsewhere.
      </Muted>

      {error && <Alert class="mt-5">{error}</Alert>}

      <form method="post" action="/reset-password" class="mt-6 flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <Field type="password" name="password" placeholder="New password" minLength={8} required />
        <Button class="mt-1" type="submit">
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
