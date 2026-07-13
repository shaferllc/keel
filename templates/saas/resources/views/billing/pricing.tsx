import Layout from "../layout.js";
import {
  brand,
  btnPrimary,
  btnSea,
  panel,
  rise,
  rise1,
  rise2,
  sectionLabel,
  shell,
  shellLinks,
  shellNav,
} from "../ui.js";

export default function Pricing({
  subscribed,
  plan,
  gateway,
}: {
  subscribed: boolean;
  plan: string;
  gateway: string;
}) {
  return (
    <Layout title="Billing">
      <main class={shell}>
        <header class={shellNav}>
          <a href="/" class={`${brand} text-2xl text-ink`}>
            Keel
          </a>
          <nav class={shellLinks}>
            <a href="/dashboard">Dashboard</a>
            <a href="/teams">Teams</a>
            <a href="/billing" aria-current="page">
              Billing
            </a>
          </nav>
        </header>

        <h1 class={`font-display ${rise} text-4xl font-bold tracking-tight`}>Billing</h1>
        <p class={`${rise1} mt-3 max-w-lg text-ink-soft`}>
          The current team is the customer. Gateway{" "}
          <code class="rounded-md bg-white/70 px-1.5 py-0.5 text-sm text-ink">{gateway}</code>.
        </p>

        <section class={`${panel} ${rise2} mt-10`}>
          <p class={sectionLabel}>Plan</p>
          <h2 class="font-display mt-2 text-3xl font-bold">Pro</h2>
          <p class="mt-3 text-sm text-ink-soft">
            Price id <code class="rounded bg-mist px-1.5 py-0.5">{plan}</code>. Set{" "}
            <code class="rounded bg-mist px-1.5 py-0.5">STRIPE_PRICE_PRO</code> to your Stripe Price.
          </p>

          {subscribed ? (
            <form method="post" action="/billing/portal" class="mt-8">
              <button class={btnPrimary} type="submit">
                Open customer portal
              </button>
            </form>
          ) : (
            <form method="post" action="/billing/subscribe" class="mt-8">
              <button class={btnSea} type="submit">
                Subscribe
              </button>
            </form>
          )}
        </section>
      </main>
    </Layout>
  );
}
