import Layout from "../layout.js";
import {
  brand,
  btnPrimary,
  field,
  muted,
  notice,
  panel,
  rise,
  rise1,
  rise2,
  rowForm,
  sectionLabel,
  shell,
  shellLinks,
  shellNav,
} from "../ui.js";

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
      <main class={shell}>
        <header class={shellNav}>
          <a href="/" class={`${brand} text-2xl text-ink`}>
            Keel
          </a>
          <nav class={shellLinks}>
            <a href="/dashboard">Dashboard</a>
            <a href="/teams" aria-current="page">
              Teams
            </a>
            <a href="/billing">Billing</a>
          </nav>
        </header>

        <h1 class={`font-display ${rise} text-4xl font-bold tracking-tight`}>Teams</h1>
        <p class={`${rise1} mt-3 text-ink-soft`}>
          Plan: {subscribed ? <strong class="text-ink">Pro</strong> : "Free"}
          {!subscribed && (
            <>
              {" · "}
              <a class="underline underline-offset-2" href="/billing">
                Upgrade
              </a>
            </>
          )}
        </p>

        {!emailVerified && (
          <div class={`${notice} ${rise2} mt-8`}>
            Confirm your email to finish setup.{" "}
            <form method="post" action="/verify-email/resend" class="inline">
              <button class="font-medium underline underline-offset-2">Resend the link</button>
            </form>
          </div>
        )}

        <section class={`${rise2} mt-10`}>
          <h2 class={sectionLabel}>Your teams</h2>
          <ul class="mt-4 flex flex-col gap-2">
            {teams.map((team) => (
              <li class={`${panel} flex items-center justify-between gap-3`}>
                <span>
                  {team.name}
                  {team.id === current && <span class={`${muted} ml-2 text-sm`}>— current</span>}
                </span>
                {team.id !== current && (
                  <form method="post" action="/teams/switch">
                    <input type="hidden" name="team_id" value={String(team.id)} />
                    <button class="text-sm font-medium text-sea underline underline-offset-2" type="submit">
                      Switch
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <form method="post" action="/teams" class={rowForm}>
            <input class={field} name="name" placeholder="New team name" required />
            <button class={btnPrimary} type="submit">
              Create
            </button>
          </form>
        </section>

        <section class="mt-12">
          <h2 class={sectionLabel}>Projects in this team</h2>
          <p class={`${muted} mt-2 text-sm`}>
            Scoped automatically — another team&apos;s project isn&apos;t hidden, it&apos;s a 404.
          </p>
          <ul class="mt-4 flex flex-col gap-2">
            {projects.map((project) => (
              <li class={panel}>{project.name}</li>
            ))}
            {projects.length === 0 && <li class={`${muted} text-sm`}>No projects yet.</li>}
          </ul>
          <form method="post" action="/projects" class={rowForm}>
            <input class={field} name="name" placeholder="New project" required />
            <button class={btnPrimary} type="submit">
              Add
            </button>
          </form>
        </section>

        <section class="mt-12">
          <h2 class={sectionLabel}>Invitations</h2>
          <p class={`${muted} mt-2 text-sm`}>Admins and owners can invite and revoke.</p>
          <ul class="mt-4 flex flex-col gap-2">
            {invitations.map((invitation) => (
              <li class={`${panel} flex items-center justify-between gap-3 text-sm`}>
                <span>
                  {invitation.email} · {invitation.role}
                </span>
                <form method="post" action="/teams/invite/revoke">
                  <input type="hidden" name="invitation_id" value={String(invitation.id)} />
                  <button class="font-medium text-danger underline underline-offset-2" type="submit">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form method="post" action="/teams/invite" class={rowForm}>
            <input class={field} type="email" name="email" placeholder="Email" required />
            <select class={`${field} max-w-36`} name="role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button class={btnPrimary} type="submit">
              Invite
            </button>
          </form>
        </section>
      </main>
    </Layout>
  );
}
