import Layout from "./layout.js";
import {
  brand,
  btnGhost,
  btnSea,
  notice,
  panel,
  rise,
  rise1,
  rise2,
  sectionLabel,
  shell,
  shellLinks,
  shellNav,
} from "./ui.js";

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
      <main class={shell}>
        <header class={shellNav}>
          <a href="/" class={`${brand} text-2xl text-ink`}>
            Keel
          </a>
          <nav class={shellLinks}>
            <a href="/dashboard" aria-current="page">
              Dashboard
            </a>
          </nav>
        </header>

        <h1 class={`font-display ${rise} text-4xl font-bold tracking-tight text-ink`}>Hello, {name}.</h1>
        <p class={`${rise1} mt-3 max-w-md text-ink-soft`}>
          Your account is ready. Tighten security when you have a moment.
        </p>

        {!emailVerified && (
          <div class={`${notice} ${rise2} mt-8`}>
            Confirm your email to finish setup.{" "}
            <form method="post" action="/verify-email/resend" class="inline">
              <button class="font-medium underline underline-offset-2">Resend the link</button>
            </form>
          </div>
        )}

        <section class={`${panel} ${rise2} mt-8`}>
          <p class={sectionLabel}>Security</p>
          <p class="mt-2 text-ink-soft">
            Two-factor authentication is <strong class="text-ink">{twoFactor ? "on" : "off"}</strong>.
          </p>
          <div class="mt-5 flex flex-wrap gap-3">
            {!twoFactor ? (
              <form method="post" action="/two-factor/enable">
                <button class={btnSea} type="submit">
                  Enable two-factor
                </button>
              </form>
            ) : (
              <form method="post" action="/two-factor/disable">
                <button class={btnGhost} type="submit">
                  Disable two-factor
                </button>
              </form>
            )}
            <form method="post" action="/logout">
              <button class={btnGhost} type="submit">
                Log out
              </button>
            </form>
          </div>
        </section>
      </main>
    </Layout>
  );
}
