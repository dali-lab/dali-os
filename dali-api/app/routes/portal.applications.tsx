import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.applications";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getActiveCycle } from "~/hiring/lib/cycles";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "~/hiring/lib/domain-application-status";
import { listMyApplications } from "~/education/lib/offerings.server";
import { MyStatusChip } from "~/education/components/OfferingCard";
import { buttonClasses } from "~/components/ui/Button";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";

export const meta: Route.MetaFunction = () => [{ title: "My applications · DALI" }];

// Compact hiring summary for the one active/most-recent cycle: the cycle name,
// the applicant's overall status, and a per-domain status line. The full
// tracker (interview booking, decision views) stays at /portal/hiring — this is
// the at-a-glance entry to it, so the combined page can list both application
// kinds without duplicating that whole surface.
async function loadHiringSummary(userId: string) {
  const active = await getActiveCycle();
  let cycleId: string;
  let cycleName: string;
  let cycleStatus: ApplicationCycleStatus;

  if (active) {
    cycleId = active.id;
    cycleName = active.name;
    cycleStatus = active.currentStatus as ApplicationCycleStatus;
  } else {
    // No active cycle: fall back to the applicant's most recent application so a
    // completed cycle still shows here.
    const recent = await prisma.application.findFirst({
      where: { userId },
      include: {
        applicationCycle: {
          include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!recent) return null;
    cycleId = recent.applicationCycleId;
    cycleName = recent.applicationCycle.name;
    cycleStatus = (recent.applicationCycle.statusUpdates[0]?.newStatus ??
      "Draft") as ApplicationCycleStatus;
  }

  const application = await prisma.application.findFirst({
    where: { userId, applicationCycleId: cycleId },
    include: {
      statusUpdates: true,
      domainApplications: {
        where: { selected: true },
        include: { ...domainApplicationStatusInclude, domain: true },
      },
    },
  });
  if (!application) return null;

  // Withdrawn (which always follows Submitted) wins over the earlier entries.
  const latest = application.statusUpdates
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.newStatus;
  const applicationStatus =
    latest === "Withdrawn"
      ? "Withdrawn"
      : application.statusUpdates.some((u) => u.newStatus === "Submitted")
        ? "Submitted"
        : "Draft";

  const domains = application.domainApplications.map((da) => ({
    id: da.id,
    domainName: da.domain?.name ?? "Unknown",
    status: inferDomainApplicationStatus(
      { ...da, application: { statusUpdates: application.statusUpdates } } as any,
      cycleStatus,
    ),
  }));

  return { cycleName, applicationStatus, domains };
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  // Lab members use the member surfaces (education hub + /hiring), not the portal.
  if (auth.user.type === "member") return redirect("/education");

  const [educationApps, hiring] = await Promise.all([
    listMyApplications(auth.user.sub),
    loadHiringSummary(auth.user.sub),
  ]);
  return { educationApps, hiring };
}

// Per-domain hiring status → a labelled pill. Kept local (not the full
// StageIndicator) because this is a summary line, not the interactive tracker.
const HIRING_STATUS: Record<string, { label: string; className: string }> = {
  ApplicationOpen: { label: "Not submitted", className: "bg-muted text-muted-foreground" },
  Pending: { label: "Under review", className: "bg-amber-100 text-amber-800" },
  InvitedToInterview: { label: "Interview invite", className: "bg-blue-100 text-blue-800" },
  InterviewScheduled: { label: "Interview scheduled", className: "bg-blue-100 text-blue-800" },
  PostInterviewPending: { label: "Decision pending", className: "bg-blue-100 text-blue-800" },
  Accepted: { label: "Accepted", className: "bg-green-100 text-green-800" },
  AcceptedElsewhere: { label: "Placed elsewhere", className: "bg-muted text-muted-foreground" },
  Waitlisted: { label: "Waitlisted", className: "bg-amber-100 text-amber-800" },
  Rejected: { label: "Not accepted", className: "bg-muted text-muted-foreground" },
  Withdrawn: { label: "Withdrawn", className: "bg-muted text-muted-foreground" },
};

function HiringStatusPill({ status }: { status: string }) {
  const s = HIRING_STATUS[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${s.className}`}
    >
      {s.label}
    </span>
  );
}

const SECTION_HEADING =
  "font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2";

export default function PortalApplications() {
  const { educationApps, hiring } = useLoaderData<typeof loader>();
  const isEmpty = !hiring && educationApps.length === 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-3xl font-bold text-dark-blue">
          My applications
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xl">
          Your DALI Lab and course applications in one place.
        </p>
      </header>

      {isEmpty ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-heading font-semibold text-dark-blue">
            You haven&apos;t applied to anything yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Apply to join the lab or register for a workshop or miniseries — your
            applications will show up here.
          </p>
        </div>
      ) : (
        <>
          {hiring && (
            <section>
              <h2 className={SECTION_HEADING}>DALI Lab</h2>
              <div className="rounded-xl border border-border bg-card p-5 shadow-brand-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-heading font-semibold text-dark-blue truncate">
                      {hiring.cycleName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Application {hiring.applicationStatus.toLowerCase()}
                    </p>
                  </div>
                  <Link to="/portal/hiring" className={buttonClasses("secondary", "sm")}>
                    Track →
                  </Link>
                </div>
                {hiring.domains.length > 0 && (
                  <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border">
                    {hiring.domains.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <span className="text-sm text-foreground">{d.domainName}</span>
                        <HiringStatusPill status={d.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {educationApps.length > 0 && (
            <section>
              <h2 className={SECTION_HEADING}>Courses</h2>
              <ul className="bg-card border border-border rounded-xl divide-y divide-border">
                {educationApps.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/portal/education/${a.offeringId}`}
                        className="text-sm font-medium text-foreground hover:text-accent-coral truncate"
                      >
                        {a.offeringTitle}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.offeringType}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.certificateId && (
                        <Link
                          to={`/education/certificates/${a.certificateId}`}
                          className="text-xs font-semibold text-accent-coral hover:underline"
                        >
                          🎓 Certificate
                        </Link>
                      )}
                      <MyStatusChip status={a.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} />;
}
