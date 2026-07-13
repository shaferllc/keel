import { AuthShell } from "./shell.js";
import { alert, btnPrimary, field, muted } from "../ui.js";

export default function Login({ error }: { error: string | null }) {
  return (
    <AuthShell title="Log in">
      <h1 class="font-display text-2xl font-bold tracking-tight">Welcome back</h1>
      <p class={`${muted} mt-2 text-sm`}>Sign in to continue.</p>

      {error && <p class={`${alert} mt-5`}>{error}</p>}

      <form method="post" action="/login" class="mt-6 flex flex-col gap-3">
        <input class={field} type="email" name="email" placeholder="Email" required />
        <input class={field} type="password" name="password" placeholder="Password" required />
        <button class={`${btnPrimary} mt-1`} type="submit">
          Log in
        </button>
      </form>

      <p class={`${muted} mt-6 text-sm`}>
        <a class="underline underline-offset-2" href="/register">
          Register
        </a>
        {" · "}
        <a class="underline underline-offset-2" href="/forgot-password">
          Forgot password?
        </a>
      </p>
    </AuthShell>
  );
}
