import { AuthShell } from "./shell.js";
import { btnPrimary, field, muted, notice } from "../ui.js";

export default function Forgot({ sent }: { sent: boolean }) {
  return (
    <AuthShell title="Reset your password">
      <h1 class="font-display text-2xl font-bold tracking-tight">Reset password</h1>
      <p class={`${muted} mt-2 text-sm`}>We&apos;ll email a link if that address has an account.</p>

      {sent ? (
        <p class={`${notice} mt-6`}>If that address has an account, a link is on its way.</p>
      ) : (
        <form method="post" action="/forgot-password" class="mt-6 flex flex-col gap-3">
          <input class={field} type="email" name="email" placeholder="Email" required />
          <button class={`${btnPrimary} mt-1`} type="submit">
            Send the link
          </button>
        </form>
      )}

      <p class={`${muted} mt-6 text-sm`}>
        <a class="underline underline-offset-2" href="/login">
          Back to log in
        </a>
      </p>
    </AuthShell>
  );
}
