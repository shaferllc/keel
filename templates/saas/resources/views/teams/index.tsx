import Layout from "../layout.js";

interface Props {
  teams: { id: number; name: string }[];
  current: number | null;
  projects: { id: number; name: string }[];
  invitations: { id: number; email: string; role: string }[];
}

export default function Teams({ teams, current, projects, invitations }: Props) {
  return (
    <Layout title="Teams">
      <main class="mx-auto max-w-2xl px-6 py-16">
        <h1 class="text-3xl font-semibold tracking-tight">Teams</h1>

        <section class="mt-8">
          <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">Your teams</h2>

          <ul class="mt-3 flex flex-col gap-2">
            {teams.map((team) => (
              <li class="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
                <span>
                  {team.name} {team.id === current && <em class="text-slate-500">— current</em>}
                </span>

                {team.id !== current && (
                  <form method="post" action="/teams/switch">
                    <input type="hidden" name="team_id" value={String(team.id)} />
                    <button class="text-sm underline">Switch</button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          <form method="post" action="/teams" class="mt-3 flex gap-2">
            <input class="flex-1 rounded-lg border border-slate-300 px-3 py-2" name="name" placeholder="New team name" required />
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Create</button>
          </form>
        </section>

        <section class="mt-10">
          <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">
            Projects in this team
          </h2>
          <p class="mt-1 text-sm text-slate-500">
            Scoped automatically — another team's project isn't just hidden, it's a 404.
          </p>

          <ul class="mt-3 flex flex-col gap-2">
            {projects.map((project) => (
              <li class="rounded-lg border border-slate-200 bg-white px-4 py-3">{project.name}</li>
            ))}
          </ul>

          <form method="post" action="/projects" class="mt-3 flex gap-2">
            <input class="flex-1 rounded-lg border border-slate-300 px-3 py-2" name="name" placeholder="New project" required />
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Add</button>
          </form>
        </section>

        <section class="mt-10">
          <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">Invitations</h2>

          <ul class="mt-3 flex flex-col gap-2">
            {invitations.map((invitation) => (
              <li class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                {invitation.email} · {invitation.role}
              </li>
            ))}
          </ul>

          <form method="post" action="/teams/invite" class="mt-3 flex gap-2">
            <input class="flex-1 rounded-lg border border-slate-300 px-3 py-2" type="email" name="email" placeholder="Email" required />
            <select class="rounded-lg border border-slate-300 px-3 py-2" name="role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-white">Invite</button>
          </form>
        </section>
      </main>
    </Layout>
  );
}
