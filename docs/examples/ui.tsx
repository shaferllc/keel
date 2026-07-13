import { Button, Field, Panel, Alert } from "@shaferllc/keel/ui";

/** Minimal login panel using the Keel UI kit. */
export default function LoginExample({ error }: { error: string | null }) {
  return (
    <Panel variant="auth">
      <h1 class="font-display text-2xl font-bold tracking-tight">Welcome back</h1>
      {error && <Alert class="mt-5">{error}</Alert>}
      <form method="post" action="/login" class="mt-6 flex flex-col gap-3">
        <Field type="email" name="email" placeholder="Email" required />
        <Field type="password" name="password" placeholder="Password" required />
        <Button type="submit">Log in</Button>
      </form>
    </Panel>
  );
}
