import Layout from "./layout.js";
import { brand, btnGhost, btnPrimary, hero, heroGlow, heroInner, muted, rise, rise1, rise2, rise3 } from "./ui.js";

export default function Welcome({ signedIn }: { signedIn: boolean }) {
  return (
    <Layout title="Keel">
      <main class={hero}>
        <div class={heroGlow} aria-hidden="true" />
        <div class={heroInner}>
          <p class={`${rise} ${muted} mb-4 text-sm tracking-[0.2em] uppercase`}>SaaS starter</p>
          <h1 class={`${brand} ${rise1} text-[clamp(3.5rem,12vw,6.5rem)] text-ink`}>Keel</h1>
          <p class={`${rise2} mt-5 max-w-md text-lg leading-relaxed text-ink-soft`}>
            Teams, invitations, and Stripe-ready billing — a quiet place to build from.
          </p>
          <div class={`${rise3} mt-10 flex flex-wrap gap-3`}>
            {signedIn ? (
              <>
                <a class={btnPrimary} href="/teams">
                  Open teams
                </a>
                <a class={btnGhost} href="/billing">
                  Billing
                </a>
              </>
            ) : (
              <>
                <a class={btnPrimary} href="/register">
                  Get started
                </a>
                <a class={btnGhost} href="/login">
                  Log in
                </a>
              </>
            )}
          </div>
        </div>
      </main>
    </Layout>
  );
}
