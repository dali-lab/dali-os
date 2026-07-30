import { Link, redirect, useLoaderData } from "react-router";
import { CalendarClock } from "lucide-react";
import type { Route } from "./+types/partner.home";
import { prisma } from "~/lib/db";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { partnerProjectsWhere } from "~/partners/lib/partner-access";
import {
  loadPartnerProjectView,
  type PartnerProjectViewData,
} from "~/partners/lib/partner-project-view.server";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";
import {
  PARTNER_APPLICATION_STATUS_LABELS,
  PARTNER_APPLICATION_STATUS_PILL,
} from "../lib/partner-application";

export const meta: Route.MetaFunction = () => [
  { title: "Partner Portal · DALI OS" },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Factual one-liner for a project card: where the work is, no health verdict.
function statusLineFor(progress: PartnerProjectViewData["progress"]): string | null {
  const pct =
    progress.overallTotal > 0
      ? Math.round((progress.overallDone / progress.overallTotal) * 100)
      : 0;
  const phase =
    progress.sprintCount === 0
      ? null
      : progress.sprintsStarted === 0
        ? "Not started yet"
        : `Sprint ${Math.min(progress.sprintsStarted, progress.sprintCount)} of ${progress.sprintCount}`;
  return (
    [phase, progress.overallTotal > 0 ? `${pct}% complete` : null]
      .filter(Boolean)
      .join(" · ") || null
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const { auth, partnerUser, org } = await requirePartner(request);

  const [applications, projectRows] = await Promise.all([
    prisma.partnerApplication.findMany({
      where: { partnerOrgId: partnerUser.partnerOrgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        resultingProjectId: true,
      },
    }),
    prisma.project.findMany({
      where: partnerProjectsWhere(partnerUser.partnerOrgId),
      orderBy: { name: "asc" },
      select: { id: true },
    }),
  ]);

  // A partner with a single project and nothing in the application pipeline has
  // just one place to be — send them straight into it.
  if (projectRows.length === 1 && applications.length === 0) {
    return redirect(`/partner/projects/${projectRows[0].id}`);
  }

  // Reuse the project-view loader so each card's status + unread count stays in
  // lockstep with the hub. Bounded in practice — a partner org has only a few
  // active projects (a lean summary query is a follow-up if that changes).
  const views = (
    await Promise.all(
      projectRows.map((p) =>
        loadPartnerProjectView(p.id, partnerUser.partnerOrgId, auth.user.sub),
      ),
    )
  ).filter((v): v is PartnerProjectViewData => v !== null);

  const projects = views.map((v) => {
    const upcoming = v.meetings[0]
      ? { label: v.meetings[0].title, at: v.meetings[0].start }
      : v.milestones[0]
        ? { label: v.milestones[0].label, at: v.milestones[0].date }
        : null;
    return {
      id: v.project.id,
      name: v.project.name,
      description: v.project.description,
      imageUrl: v.project.imageUrl,
      statusLine: statusLineFor(v.progress),
      newCount: v.activity.filter((a) => a.isNew).length,
      next: upcoming,
    };
  });

  return { org, firstName: auth.user.firstName, applications, projects };
}

export default function PartnerHome() {
  const { org, firstName, applications, projects } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-3xl font-bold text-dark-blue">
          {/* Greet the person — the org name already sits in the nav chip. */}
          Welcome, {firstName || org.name}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your projects and applications with the DALI Lab.
        </p>
      </div>

      <section>
        <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
          Your projects
        </h2>
        {projects.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No active projects yet. Once an application is accepted and a
              team is staffed, your project will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/partner/projects/${p.id}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:border-accent-coral"
              >
                <ProjectCoverImage
                  name={p.name}
                  imageUrl={p.imageUrl}
                  className="w-full h-32 object-cover"
                  placeholderClassName="w-full h-32"
                />
                <div className="flex flex-col gap-1.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-heading font-semibold text-dark-blue transition group-hover:text-accent-coral">
                      {p.name}
                    </span>
                    {p.newCount > 0 && (
                      <span className="flex-shrink-0 rounded-full bg-accent-coral/10 px-2 py-0.5 text-xs font-medium text-accent-coral">
                        {p.newCount} new
                      </span>
                    )}
                  </div>
                  {p.statusLine && (
                    <p className="text-xs font-medium text-dark-blue">
                      {p.statusLine}
                    </p>
                  )}
                  {p.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  {p.next && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">
                        Next: {p.next.label} · {fmtDate(p.next.at)}
                      </span>
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-semibold text-dark-blue">
            Applications
          </h2>
          <Link
            to="/partner/apply"
            className="text-sm font-medium text-accent-coral hover:underline"
          >
            + Pitch a project
          </Link>
        </div>
        {applications.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No applications yet — tell us what you'd like to build together.
            </p>
            <Link
              to="/partner/apply"
              className="inline-block rounded-xl bg-dark-blue text-white font-heading font-semibold px-5 py-2.5 text-sm hover:opacity-90 transition"
            >
              Pitch a project
            </Link>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl divide-y divide-border">
            {applications.map((a) => (
              <Link
                key={a.id}
                to={`/partner/applications/${a.id}`}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground block truncate">
                    {a.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Submitted{" "}
                    {new Date(a.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <span
                  className={`text-xs rounded-full px-2 py-0.5 flex-shrink-0 ${PARTNER_APPLICATION_STATUS_PILL[a.status]}`}
                >
                  {PARTNER_APPLICATION_STATUS_LABELS[a.status]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
