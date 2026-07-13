import { AuthShell } from "./shell.js";
import { alert, btnPrimary, field, muted } from "../ui.js";

export default function Register({ error }: { error: string | null }) {
  return (
    <AuthShell title="Register">
      <h1 class="font-display text-2xl font-bold tracking-tight">Create an account</h1>
      <p class={`${muted} mt-2 text-sm`}>A personal team is created for you on signup.</p>

      {error && <p class={`${alert} mt-5`}>{error}</p>}

      <form method="post" action="/register" class="mt-6 flex flex-col gap-3">
        <input class={field} name="name" placeholder="Name" required />
        <input class={field} type="email" name="email" placeholder="Email" required />
        <input class={field} type="password" name="password" placeholder="Password" required />
        <button class={`${btnPrimary} mt-1`} type="submit">
          Register
        </button>
      </form>

      <p class={`${muted} mt-6 text-sm`}>
        Already have an account?{" "}
        <a class="underline underline-offset-2" href="/login">
          Log in
        </a>
      </p>
    </AuthShell>
  );
}
