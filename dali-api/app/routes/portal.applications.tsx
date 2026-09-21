import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.applications";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
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

// Compact hiring summary, one per application across every cycle the student
// applied to (newest first): the cycle name, the applicant's overall status,
// and a per-domain status line. The full tracker (interview booking, decision
// views) stays at /portal/hiring — this is the at-a-glance entry to it, so the
// combined page can list both application kinds without duplicating that
// whole surface.
async function loadHiringSummaries(userId: string) {
  const applications = await prisma.application.findMany({
    where: { userId, applicationCycle: { applicants: "Students" } },
    include: {
      statusUpdates: true,
      applicationCycle: {
        include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
      domainApplications: {
        where: { selected: true },
        include: { ...domainApplicationStatusInclude, domain: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return applications.map((application) => {
    const cycle = application.applicationCycle;
    const latestCycleStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
    // An Open cycle past its close date is under review, as getActiveCycles derives.
    const cycleStatus = (
      latestCycleStatus === "Open" && cycle.closeDate && new Date() > cycle.closeDate
        ? "UnderReview"
        : latestCycleStatus
    ) as ApplicationCycleStatus;

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

    return {
      id: application.id,
      cycleId: cycle.id,
      cycleName: cycle.name,
      applicationStatus,
      domains,
    };
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  // Lab members use the member surfaces (education hub + /hiring), not the portal.
  if (auth.user.type === "member") return redirect("/education");

  const [educationApps, hiring] = await Promise.all([
    listMyApplications(auth.user.sub),
    loadHiringSummaries(auth.user.sub),
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
  const isEmpty = hiring.length === 0 && educationApps.length === 0;

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
          {hiring.length > 0 && (
            <section>
              <h2 className={SECTION_HEADING}>DALI Lab</h2>
              <div className="flex flex-col gap-3">
                {hiring.map((app) => (
                  <div key={app.id} className="rounded-xl border border-border bg-card p-5 shadow-brand-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-heading font-semibold text-dark-blue truncate">
                          {app.cycleName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Application {app.applicationStatus.toLowerCase()}
                        </p>
                      </div>
                      <Link
                        to={`/portal/hiring?cycle=${app.cycleId}`}
                        className={buttonClasses("secondary", "sm")}
                      >
                        Track →
                      </Link>
                    </div>
                    {app.domains.length > 0 && (
                      <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border">
                        {app.domains.map((d) => (
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
                ))}
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
