import { Alert, Button, Field, Muted } from "@shaferllc/keel/ui";
import { AuthShell } from "./shell.js";
import { SocialButtons } from "./social.js";
import { alert, btnPrimary, field, muted } from "../ui.js";

export default function Login({ error }: { error: string | null }) {
  return (
    <AuthShell title="Log in">
      <h1 class="font-display text-2xl font-bold tracking-tight">Welcome back</h1>
      <Muted class="mt-2 text-sm">Sign in to continue.</Muted>

      {error && <Alert class="mt-5">{error}</Alert>}

      <form method="post" action="/login" class="mt-6 flex flex-col gap-3">
        <Field type="email" name="email" placeholder="Email" required />
        <Field type="password" name="password" placeholder="Password" required />
        <Button class="mt-1" type="submit">
          Log in
        </Button>
      </form>

      <SocialButtons />

      <p class={`${muted} mt-6 text-sm`}>
        <a class="underline underline-offset-2" href="/register">
          Register
        </a>
        {" · "}
        <a class="underline underline-offset-2" href="/forgot-password">
          Forgot password?
        </a>
      </Muted>
    </AuthShell>
  );
}
