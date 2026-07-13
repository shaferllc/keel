import { Alert, Button, Field, Muted } from "@shaferllc/keel/ui";
import { AuthShell } from "./shell.js";
import { SocialButtons } from "./social.js";

export default function Register({ error }: { error: string | null }) {
  return (
    <AuthShell title="Register">
      <h1 class="font-display text-2xl font-bold tracking-tight">Create an account</h1>
      <Muted class="mt-2 text-sm">Sessions, reset, and two-factor are already wired.</Muted>

      {error && <Alert class="mt-5">{error}</Alert>}

      <form method="post" action="/register" class="mt-6 flex flex-col gap-3">
        <Field name="name" placeholder="Name" required />
        <Field type="email" name="email" placeholder="Email" required />
        <Field type="password" name="password" placeholder="Password" required />
        <Button class="mt-1" type="submit">
          Register
        </Button>
      </form>

      <SocialButtons />

      <Muted class="mt-6 text-sm">
        Already have an account?{" "}
        <a class="underline underline-offset-2" href="/login">
          Log in
        </a>
      </Muted>
    </AuthShell>
  );
}
