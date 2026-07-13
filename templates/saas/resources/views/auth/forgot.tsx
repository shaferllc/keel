import { Button, Field, Muted, Notice } from "@shaferllc/keel/ui";
import { AuthShell } from "./shell.js";

export default function Forgot({ sent }: { sent: boolean }) {
  return (
    <AuthShell title="Reset your password">
      <h1 class="font-display text-2xl font-bold tracking-tight">Reset password</h1>
      <Muted class="mt-2 text-sm">We&apos;ll email a link if that address has an account.</Muted>

      {sent ? (
        <Notice class="mt-6">If that address has an account, a link is on its way.</Notice>
      ) : (
        <form method="post" action="/forgot-password" class="mt-6 flex flex-col gap-3">
          <Field type="email" name="email" placeholder="Email" required />
          <Button class="mt-1" type="submit">
            Send the link
          </Button>
        </form>
      )}

      <Muted class="mt-6 text-sm">
        <a class="underline underline-offset-2" href="/login">
          Back to log in
        </a>
      </Muted>
    </AuthShell>
  );
}
