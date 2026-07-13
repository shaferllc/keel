import { Brand, Button, Hero, HeroGlow, HeroInner, Muted, Rise } from "@shaferllc/keel/ui";
import Layout from "./layout.js";

export default function Welcome({ signedIn }: { signedIn: boolean }) {
  return (
    <Layout title="Keel">
      <Hero>
        <HeroGlow />
        <HeroInner>
          <Muted class="mb-4 text-sm tracking-[0.2em] uppercase">
            <Rise step={0} as="span">
              SaaS starter
            </Rise>
          </Muted>
          <Rise step={1} as="h1" class="text-[clamp(3.5rem,12vw,6.5rem)] text-ink">
            <Brand>Keel</Brand>
          </Rise>
          <Rise step={2} as="p" class="mt-5 max-w-md text-lg leading-relaxed text-ink-soft">
            Teams, invitations, and Stripe-ready billing — a quiet place to build from.
          </Rise>
          <Rise step={3} class="mt-10 flex flex-wrap gap-3">
            {signedIn ? (
              <>
                <Button href="/teams">Open teams</Button>
                <Button href="/billing" variant="ghost">
                  Billing
                </Button>
              </>
            ) : (
              <>
                <Button href="/register">Get started</Button>
                <Button href="/login" variant="ghost">
                  Log in
                </Button>
              </>
            )}
          </Rise>
        </HeroInner>
      </Hero>
    </Layout>
  );
}
