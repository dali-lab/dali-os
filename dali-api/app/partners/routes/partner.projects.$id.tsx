import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/partner.projects.$id";
import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { fullName, termCodeLabel } from "~/lib/display";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";

export const meta: Route.MetaFunction = ({ data }) => {
  const n = (data as { project?: { name: string } } | undefined)?.project?.name;
  return [{ title: n ? `${n} · DALI OS` : "Project · DALI OS" }];
};

type SprintSummary = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "Active" | "Closed";
  done: number;
  open: number;
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, partnerUser, org } = await requirePartner(request);
  // 404 (not 403) so inaccessible project ids don't leak existence.
  if (!(await partnerHasProjectAccess(auth.user.sub, params.id!))) {
    throw new Response("Not found", { status: 404 });
  }

  // Every select below is deliberately minimal — this loader is the whole
  // partner read-surface for a project. No assignees on tasks, no levels on
  // the roster, nothing from unshared pages.
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      imageUrl: true,
      projectTerms: {
        select: { term: { select: { code: true, sortKey: true } } },
      },
    },
  });
  if (!project) throw new Response("Not found", { status: 404 });

  const current = await currentTerm();

  const [
    partnership,
    assignments,
    activeSprints,
    plannedSprint,
    lastClosedSprint,
    recentlyDone,
    sharedPages,
  ] = await Promise.all([
    prisma.projectPartner.findFirst({
      where: { projectId: project.id, partnerOrgId: partnerUser.partnerOrgId },
      select: { startedAt: true },
    }),
    current
      ? prisma.projectAssignment.findMany({
          where: { projectId: project.id, termId: current.id },
          select: {
            user: { select: { id: true, firstName: true, lastName: true } },
            domain: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.sprint.findMany({
      where: { projectId: project.id, status: "Active" },
      orderBy: { startsAt: "asc" },
      select: { id: true, name: true, startsAt: true, endsAt: true },
    }),
    prisma.sprint.findFirst({
      where: { projectId: project.id, status: "Planned" },
      orderBy: { startsAt: "asc" },
      select: { name: true, startsAt: true, endsAt: true },
    }),
    prisma.sprint.findFirst({
      where: { projectId: project.id, status: "Closed" },
      orderBy: { endsAt: "desc" },
      select: { id: true, name: true, startsAt: true, endsAt: true },
    }),
    prisma.task.findMany({
      where: { projectId: project.id, status: "Done" },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        domain: { select: { displayName: true } },
      },
    }),
    prisma.page.findMany({
      where: {
        workspaceType: "Project",
        workspaceId: project.id,
        archivedAt: null,
        partnerVisible: true,
      },
      orderBy: { position: "asc" },
      select: { id: true, title: true, iconEmoji: true, updatedAt: true },
    }),
  ]);

  // Progress counts for the sprints we'll show (active, or the last closed
  // one as a fallback so the page never reads empty between sprints).
  const summarySprints = activeSprints.length
    ? activeSprints.map((s) => ({ ...s, status: "Active" as const }))
    : lastClosedSprint
      ? [{ ...lastClosedSprint, status: "Closed" as const }]
      : [];
  const counts = summarySprints.length
    ? await prisma.task.groupBy({
        by: ["sprintId", "status"],
        where: {
          projectId: project.id,
          sprintId: { in: summarySprints.map((s) => s.id) },
        },
        _count: { _all: true },
      })
    : [];

  const sprints: SprintSummary[] = summarySprints.map((s) => {
    const mine = counts.filter((c) => c.sprintId === s.id);
    const total = mine.reduce((sum, c) => sum + c._count._all, 0);
    const done = mine
      .filter((c) => c.status === "Done")
      .reduce((sum, c) => sum + c._count._all, 0);
    const cancelled = mine
      .filter((c) => c.status === "Cancelled")
      .reduce((sum, c) => sum + c._count._all, 0);
    return {
      id: s.id,
      name: s.name,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: s.status,
      done,
      open: Math.max(0, total - cancelled - done),
    };
  });

  // Dedupe the roster: one row per person, domains joined.
  const roster = new Map<string, { name: string; domains: Set<string> }>();
  for (const a of assignments) {
    const entry = roster.get(a.user.id) ?? {
      name: fullName(a.user),
      domains: new Set<string>(),
    };
    entry.domains.add(a.domain.name);
    roster.set(a.user.id, entry);
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      imageUrl: await resolvePhotoUrl(project.imageUrl),
      terms: [...project.projectTerms]
        .sort((a, b) => a.term.sortKey - b.term.sortKey)
        .map((t) => t.term.code),
    },
    org: { name: org.name },
    partnerSince: partnership?.startedAt?.toISOString() ?? null,
    currentTermCode: current?.code ?? null,
    team: [...roster.values()].map((r) => ({
      name: r.name,
      domains: [...r.domains].sort(),
    })),
    sprints,
    nextSprint: plannedSprint
      ? {
          name: plannedSprint.name,
          startsAt: plannedSprint.startsAt.toISOString(),
          endsAt: plannedSprint.endsAt.toISOString(),
        }
      : null,
    recentlyDone: recentlyDone.map((t) => ({
      id: t.id,
      title: t.title,
      doneAt: t.updatedAt.toISOString(),
      domain: t.domain?.displayName ?? null,
    })),
    sharedPages: sharedPages.map((p) => ({
      id: p.id,
      title: p.title,
      iconEmoji: p.iconEmoji,
      updatedAt: p.updatedAt.toISOString(),
    })),
  };
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function PartnerProjectView() {
  const {
    project,
    partnerSince,
    currentTermCode,
    team,
    sprints,
    nextSprint,
    recentlyDone,
    sharedPages,
  } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link to="/partner" className="text-xs text-muted-foreground hover:text-foreground">
          ← Back to portal
        </Link>
        <div className="mt-2 bg-card border border-border rounded-2xl overflow-hidden">
          {project.imageUrl && (
            <img src={project.imageUrl} alt="" className="w-full h-40 object-cover" />
          )}
          <div className="p-5">
            <h1 className="font-heading text-3xl font-bold text-dark-blue">
              {project.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {[
                project.terms.length > 0
                  ? `Terms: ${project.terms.map(termCodeLabel).join(", ")}`
                  : null,
                partnerSince ? `Partner since ${fmtDate(partnerSince)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {project.description && (
              <p className="text-sm text-foreground mt-3 whitespace-pre-wrap">
                {project.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* What's going on right now */}
      <section>
        <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
          Current work
        </h2>
        {sprints.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            No sprint in flight right now.
            {nextSprint && (
              <>
                {" "}Next up: <strong>{nextSprint.name}</strong> ({fmtDate(nextSprint.startsAt)} – {fmtDate(nextSprint.endsAt)}).
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sprints.map((s) => {
              const total = s.done + s.open;
              const pct = total > 0 ? Math.round((s.done / total) * 100) : 0;
              return (
                <div key={s.id} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-heading font-semibold text-dark-blue">
                      {s.name}
                    </span>
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 ${
                        s.status === "Active"
                          ? "bg-accent-teal/15 text-accent-teal"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.status === "Active" ? "In progress" : "Wrapped up"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fmtDate(s.startsAt)} – {fmtDate(s.endsAt)}
                  </p>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>
                        {s.done} of {total} tasks done
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-accent-teal rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {nextSprint && (
              <div className="bg-card border border-dashed border-border rounded-2xl p-5 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Next up:</span>{" "}
                {nextSprint.name} ({fmtDate(nextSprint.startsAt)} – {fmtDate(nextSprint.endsAt)})
              </div>
            )}
          </div>
        )}
      </section>

      {recentlyDone.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Recently completed
          </h2>
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {recentlyDone.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className="text-accent-teal">✓</span>
                <span className="flex-1 min-w-0 truncate text-foreground">{t.title}</span>
                {t.domain && (
                  <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5 flex-shrink-0">
                    {t.domain}
                  </span>
                )}
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {fmtDate(t.doneAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Shared docs */}
      <section>
        <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
          Shared documents
        </h2>
        {sharedPages.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            The team hasn't shared any documents yet.
          </div>
        ) : (
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {sharedPages.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/partner/projects/${project.id}/pages/${p.id}`}
                  className="px-4 py-3 flex items-center gap-3 text-sm hover:bg-muted/20 transition"
                >
                  <span>{p.iconEmoji ?? "📄"}</span>
                  <span className="flex-1 min-w-0 truncate font-medium text-foreground">
                    {p.title}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    Updated {fmtDate(p.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Team */}
      {team.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Your DALI team{currentTermCode ? ` · ${termCodeLabel(currentTermCode)}` : ""}
          </h2>
          <div className="bg-card border border-border rounded-2xl p-5 flex flex-wrap gap-3">
            {team.map((m) => (
              <div
                key={m.name}
                className="rounded-xl bg-brand-tint px-3 py-2 text-sm"
              >
                <span className="font-medium text-dark-blue">{m.name}</span>
                <span className="text-xs text-muted-foreground block">
                  {m.domains.join(", ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
