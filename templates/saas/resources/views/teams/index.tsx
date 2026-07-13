import {
  Brand,
  Button,
  Field,
  Muted,
  Notice,
  Panel,
  Rise,
  SectionLabel,
  Shell,
  ShellLinks,
  ShellNav,
  classes,
} from "@shaferllc/keel/ui";
import Layout from "../layout.js";

interface Props {
  teams: { id: number; name: string }[];
  current: number | null;
  projects: { id: number; name: string }[];
  invitations: { id: number; email: string; role: string }[];
  subscribed: boolean;
  emailVerified: boolean;
}

export default function Teams({
  teams,
  current,
  projects,
  invitations,
  subscribed,
  emailVerified,
}: Props) {
  return (
    <Layout title="Teams">
      <Shell>
        <ShellNav>
          <Brand href="/" class="text-2xl text-ink">
            Keel
          </Brand>
          <ShellLinks>
            <a href="/dashboard">Dashboard</a>
            <a href="/teams" aria-current="page">
              Teams
            </a>
            <a href="/billing">Billing</a>
          </ShellLinks>
        </ShellNav>

        <Rise step={0} as="h1" class="font-display text-4xl font-bold tracking-tight">
          Teams
        </Rise>
        <Rise step={1} as="p" class="mt-3 text-ink-soft">
          Plan: {subscribed ? <strong class="text-ink">Pro</strong> : "Free"}
          {!subscribed && (
            <>
              {" · "}
              <a class="underline underline-offset-2" href="/billing">
                Upgrade
              </a>
            </>
          )}
        </Rise>

        {!emailVerified && (
          <Notice class="mt-8 keel-rise keel-rise--2">
            Confirm your email to finish setup.{" "}
            <form method="post" action="/verify-email/resend" class="inline">
              <button class="font-medium underline underline-offset-2">Resend the link</button>
            </form>
          </Notice>
        )}

        <section class="mt-10 keel-rise keel-rise--2">
          <SectionLabel as="h2">Your teams</SectionLabel>
          <ul class="mt-4 flex flex-col gap-2">
            {teams.map((team) => (
              <Panel as="li" class="flex items-center justify-between gap-3">
                <span>
                  {team.name}
                  {team.id === current && (
                    <Muted as="span" class="ml-2 text-sm">
                      — current
                    </Muted>
                  )}
                </span>
                {team.id !== current && (
                  <form method="post" action="/teams/switch">
                    <input type="hidden" name="team_id" value={String(team.id)} />
                    <button class="text-sm font-medium text-sea underline underline-offset-2" type="submit">
                      Switch
                    </button>
                  </form>
                )}
              </Panel>
            ))}
          </ul>
          <form method="post" action="/teams" class={classes.rowForm}>
            <Field name="name" placeholder="New team name" required />
            <Button type="submit">Create</Button>
          </form>
        </section>

        <section class="mt-12">
          <SectionLabel as="h2">Projects in this team</SectionLabel>
          <Muted class="mt-2 text-sm">
            Scoped automatically — another team&apos;s project isn&apos;t hidden, it&apos;s a 404.
          </Muted>
          <ul class="mt-4 flex flex-col gap-2">
            {projects.map((project) => (
              <Panel as="li">{project.name}</Panel>
            ))}
            {projects.length === 0 && (
              <li>
                <Muted as="span" class="text-sm">
                  No projects yet.
                </Muted>
              </li>
            )}
          </ul>
          <form method="post" action="/projects" class={classes.rowForm}>
            <Field name="name" placeholder="New project" required />
            <Button type="submit">Add</Button>
          </form>
        </section>

        <section class="mt-12">
          <SectionLabel as="h2">Invitations</SectionLabel>
          <Muted class="mt-2 text-sm">Admins and owners can invite and revoke.</Muted>
          <ul class="mt-4 flex flex-col gap-2">
            {invitations.map((invitation) => (
              <Panel as="li" class="flex items-center justify-between gap-3 text-sm">
                <span>
                  {invitation.email} · {invitation.role}
                </span>
                <form method="post" action="/teams/invite/revoke">
                  <input type="hidden" name="invitation_id" value={String(invitation.id)} />
                  <button class="font-medium text-danger underline underline-offset-2" type="submit">
                    Revoke
                  </button>
                </form>
              </Panel>
            ))}
          </ul>
          <form method="post" action="/teams/invite" class={classes.rowForm}>
            <Field type="email" name="email" placeholder="Email" required />
            <select class={`${classes.field} max-w-36`} name="role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button type="submit">Invite</Button>
          </form>
        </section>
      </Shell>
    </Layout>
  );
}
