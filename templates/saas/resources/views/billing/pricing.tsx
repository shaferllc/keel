import Layout from "../layout.js";

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
      <main class="mx-auto max-w-2xl px-6 py-16">
        <div class="flex items-start justify-between gap-4">
          <h1 class="text-3xl font-semibold tracking-tight">Billing</h1>
          <a class="text-sm underline" href="/teams">
            Teams
          </a>
        </div>

        <p class="mt-4 text-slate-600">
          The <strong>current team</strong> is the customer. Gateway:{" "}
          <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">{gateway}</code>
        </p>

        <section class="mt-10 rounded-lg border border-slate-200 bg-white p-6">
          <h2 class="text-xl font-semibold">Pro</h2>
          <p class="mt-2 text-sm text-slate-600">
            Price id <code class="rounded bg-slate-100 px-1">{plan}</code>. Set{" "}
            <code class="rounded bg-slate-100 px-1">STRIPE_PRICE_PRO</code> to your Stripe Price.
          </p>

          {subscribed ? (
            <form method="post" action="/billing/portal" class="mt-6">
              <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">
                Open customer portal
              </button>
            </form>
          ) : (
            <form method="post" action="/billing/subscribe" class="mt-6">
              <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Subscribe</button>
            </form>
          )}
        </section>
      </main>
    </Layout>
  );
}
