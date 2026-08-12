import { Link, redirect, useLoaderData } from "react-router";
import { ArrowRight } from "lucide-react";
import type { Route } from "./+types/admin";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { prisma } from "~/lib/db";
import { cn } from "~/lib/cn";
import { ADMIN_CLUSTERS } from "~/admin/adminNav";

export const meta: Route.MetaFunction = () => [{ title: "Admin · DALI OS" }];

// Any Core member may enter the area; the Finance cluster is Admin-only and
// hidden from the grouped dashboard for everyone else.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");
  // Live signals surfaced on the relevant cluster cards. Both are cheap counts
  // and default to 0, so the hub degrades gracefully if either table is empty.
  const [admin, announcements, jobs] = await Promise.all([
    isAdmin(auth.user.sub),
    prisma.scheduledAnnouncement.count({
      where: { sentAt: null, canceledAt: null },
    }),
    prisma.scheduledJob.count({ where: { enabled: true, lastStatus: "Error" } }),
  ]);
  // Hide the "documents" cluster (Agreements) from the Admin hub when
  // drive-consolidation is on — agreements are authored in the Drive instead.
  // Build the minimal UserRoles shape isFeatureEnabled expects: flag targeting
  // for drive-consolidation is role-based (everyone/role/user), so we only need
  // the booleans that ROLE_TARGETS covers. isAdmin is resolved from the parallel
  // query above.
  const driveConsolidation = await isFeatureEnabled("drive-consolidation", auth.user.sub, {
    isCore: true, // already verified above
    isAdmin: admin,
    isLabMember: true,
    isDomainLead: false,
    isInstructor: false,
    isInterviewer: false,
    isAlumni: false,
    isStaff: false,
    canViewForms: true, // irrelevant for flag targeting
    canViewStaffing: true, // irrelevant for flag targeting
  });
  return {
    isAdmin: admin,
    driveConsolidation,
    badges: { announcements, jobs } as Record<string, number>,
  };
}

function badgeLabel(key: string, n: number): string {
  if (key === "announcements") return `${n} scheduled`;
  if (key === "jobs") return `${n} failing`;
  return String(n);
}

export default function AdminHub() {
  const { isAdmin: admin, driveConsolidation, badges } = useLoaderData<typeof loader>();
  // When drive-consolidation is on, agreements live in the Drive — the
  // "documents" cluster is removed from the Admin hub to keep one authoring surface.
  const clusters = ADMIN_CLUSTERS.filter(
    (c) => (admin || !c.adminOnly) && !(driveConsolidation && c.key === "documents"),
  );
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Admin</h1>
      </header>
      {clusters.map((cluster) => (
        <section key={cluster.key} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <cluster.icon
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-hidden
              />
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {cluster.label}
              </h2>
            </div>
            {cluster.hubPath && (
              <Link
                to={cluster.hubPath}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline"
              >
                Open <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cluster.sections.map((s) => (
              <Link
                key={s.key}
                to={s.to}
                className="bg-card border border-border shadow-brand-1 rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-brand-2 transition-all"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <s.icon
                      className="h-4 w-4 text-accent-coral shrink-0"
                      aria-hidden
                    />
                    <h3 className="font-heading font-semibold text-foreground truncate">
                      {s.label}
                    </h3>
                  </div>
                  {badges[s.key] > 0 && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                        s.key === "jobs"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-accent-coral/10 text-accent-coral",
                      )}
                    >
                      {badgeLabel(s.key, badges[s.key])}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {s.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
