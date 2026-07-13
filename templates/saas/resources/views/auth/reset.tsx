import { AuthShell } from "./shell.js";
import { alert, btnPrimary, field, muted } from "../ui.js";

export default function Reset({ token, error }: { token: string; error: string | null }) {
  return (
    <AuthShell title="Choose a new password">
      <h1 class="font-display text-2xl font-bold tracking-tight">New password</h1>
      <p class={`${muted} mt-2 text-sm`}>
        Choose something you&apos;ll remember — and haven&apos;t used elsewhere.
      </p>

      {error && <p class={`${alert} mt-5`}>{error}</p>}

      <form method="post" action="/reset-password" class="mt-6 flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <input
          class={field}
          type="password"
          name="password"
          placeholder="New password"
          minLength={8}
          required
        />
        <button class={`${btnPrimary} mt-1`} type="submit">
          Update password
        </button>
      </form>
    </AuthShell>
  );
}
