import {
  Brand,
  Button,
  Notice,
  Panel,
  Rise,
  SectionLabel,
  Shell,
  ShellLinks,
  ShellNav,
} from "@shaferllc/keel/ui";
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
      <Shell>
        <ShellNav>
          <Brand href="/" class="text-2xl text-ink">
            Keel
          </Brand>
          <ShellLinks>
            <a href="/dashboard" aria-current="page">
              Dashboard
            </a>
            <a href="/teams">Teams</a>
            <a href="/billing">Billing</a>
          </ShellLinks>
        </ShellNav>

        <Rise step={0} as="h1" class="font-display text-4xl font-bold tracking-tight text-ink">
          Hello, {name}.
        </Rise>
        <Rise step={1} as="p" class="mt-3 max-w-md text-ink-soft">
          Your account is ready. Tighten security when you have a moment.
        </Rise>

        {!emailVerified && (
          <Notice class="mt-8 keel-rise keel-rise--2">
            Confirm your email to finish setup.{" "}
            <form method="post" action="/verify-email/resend" class="inline">
              <button class="font-medium underline underline-offset-2">Resend the link</button>
            </form>
          </Notice>
        )}

        <Panel class="mt-8 keel-rise keel-rise--2">
          <SectionLabel>Security</SectionLabel>
          <p class="mt-2 text-ink-soft">
            Two-factor authentication is <strong class="text-ink">{twoFactor ? "on" : "off"}</strong>.
          </p>
          <div class="mt-5 flex flex-wrap gap-3">
            {!twoFactor ? (
              <form method="post" action="/two-factor/enable">
                <Button variant="sea" type="submit">
                  Enable two-factor
                </Button>
              </form>
            ) : (
              <form method="post" action="/two-factor/disable">
                <Button variant="ghost" type="submit">
                  Disable two-factor
                </Button>
              </form>
            )}
            <form method="post" action="/logout">
              <Button variant="ghost" type="submit">
                Log out
              </Button>
            </form>
          </div>
        </Panel>
      </Shell>
    </Layout>
  );
}
