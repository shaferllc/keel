import { AuthShell } from "./shell.js";
import { alert, btnPrimary, field, muted } from "../ui.js";

export default function TwoFactor({ error }: { error: string | null }) {
  return (
    <AuthShell title="Two-factor">
      <h1 class="font-display text-2xl font-bold tracking-tight">Two-factor</h1>
      <p class={`${muted} mt-2 text-sm`}>
        Your password was accepted. You are not signed in until this code checks out.
      </p>

      {error && <p class={`${alert} mt-5`}>{error}</p>}

      <form method="post" action="/two-factor" class="mt-6 flex flex-col gap-3">
        <input
          class={field}
          name="code"
          placeholder="6-digit code, or a recovery code"
          required
          autofocus
        />
        <button class={`${btnPrimary} mt-1`} type="submit">
          Continue
        </button>
      </form>
    </AuthShell>
  );
}
