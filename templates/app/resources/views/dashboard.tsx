import Layout from "./layout.js";

export default function Dashboard({
  name,
  twoFactor,
  emailVerified,
}: {
  name: string;
  twoFactor: boolean;
  emailVerified: boolean;
}) {
  return (
    <Layout title="Dashboard">
      <main class="mx-auto max-w-2xl px-6 py-16">
        <h1 class="text-3xl font-semibold tracking-tight">Hello, {name}.</h1>

        {!emailVerified && (
          <div class="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Confirm your email to finish setup.{" "}
            <form method="post" action="/verify-email/resend" class="inline">
              <button class="underline">Resend the link</button>
            </form>
          </div>
        )}

        <p class="mt-4 text-slate-600">
          Two-factor is {twoFactor ? "on" : "off"}.
        </p>

        <div class="mt-4 flex flex-wrap gap-3">
          {!twoFactor ? (
            <form method="post" action="/two-factor/enable">
              <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Enable two-factor</button>
            </form>
          ) : (
            <form method="post" action="/two-factor/disable">
              <button class="rounded-lg border border-slate-300 px-4 py-2">Disable two-factor</button>
            </form>
          )}
        </div>

        <form method="post" action="/logout" class="mt-8">
          <button class="rounded-lg border border-slate-300 px-4 py-2">Log out</button>
        </form>
      </main>
    </Layout>
  );
}
