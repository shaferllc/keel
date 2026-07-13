import {
  Brand,
  Button,
  Panel,
  Rise,
  SectionLabel,
  Shell,
  ShellLinks,
  ShellNav,
} from "@shaferllc/keel/ui";
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
      <Shell>
        <ShellNav>
          <Brand href="/" class="text-2xl text-ink">
            Keel
          </Brand>
          <ShellLinks>
            <a href="/dashboard">Dashboard</a>
            <a href="/teams">Teams</a>
            <a href="/billing" aria-current="page">
              Billing
            </a>
          </ShellLinks>
        </ShellNav>

        <Rise step={0} as="h1" class="font-display text-4xl font-bold tracking-tight">
          Billing
        </Rise>
        <Rise step={1} as="p" class="mt-3 max-w-lg text-ink-soft">
          The current team is the customer. Gateway{" "}
          <code class="rounded-md bg-white/70 px-1.5 py-0.5 text-sm text-ink">{gateway}</code>.
        </Rise>

        <Panel class="mt-10 keel-rise keel-rise--2">
          <SectionLabel>Plan</SectionLabel>
          <h2 class="font-display mt-2 text-3xl font-bold">Pro</h2>
          <p class="mt-3 text-sm text-ink-soft">
            Price id <code class="rounded bg-mist px-1.5 py-0.5">{plan}</code>. Set{" "}
            <code class="rounded bg-mist px-1.5 py-0.5">STRIPE_PRICE_PRO</code> to your Stripe Price.
          </p>

          {subscribed ? (
            <form method="post" action="/billing/portal" class="mt-8">
              <Button type="submit">Open customer portal</Button>
            </form>
          ) : (
            <form method="post" action="/billing/subscribe" class="mt-8">
              <Button variant="sea" type="submit">
                Subscribe
              </Button>
            </form>
          )}
        </Panel>
      </Shell>
    </Layout>
  );
}
