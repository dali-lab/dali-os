import { redirect, useLoaderData, Link } from "react-router";
import { applicantPortalPath } from "~/hiring/lib/applicant-groups";
import { Pill, type PillTone } from "~/hiring/components/cycle-setup/SetupCard";
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
      // An unsubmitted draft in an open cycle opens the form itself.
      href:
        applicationStatus === "Draft" && cycleStatus === "Open"
          ? applicantPortalPath("Students", cycle.id)
          : `/portal/hiring?cycle=${cycle.id}`,
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

// Per-domain hiring status → a labelled dot pill. Kept local (not the full
// StageIndicator) because this is a summary line, not the interactive tracker.
const HIRING_STATUS: Record<string, { label: string; dot: PillTone }> = {
  ApplicationOpen: { label: "Not submitted", dot: "neutral" },
  Pending: { label: "Under review", dot: "warning" },
  InvitedToInterview: { label: "Interview invite", dot: "accent" },
  InterviewScheduled: { label: "Interview scheduled", dot: "accent" },
  PostInterviewPending: { label: "Decision pending", dot: "accent" },
  Accepted: { label: "Accepted", dot: "success" },
  AcceptedElsewhere: { label: "Placed elsewhere", dot: "neutral" },
  Waitlisted: { label: "Waitlisted", dot: "warning" },
  Rejected: { label: "Not accepted", dot: "danger" },
  Withdrawn: { label: "Withdrawn", dot: "neutral" },
};

const SECTION_HEADING =
  "font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2";

// Both sections share one row: the title link stretches over the whole row, so
// the row is the button. Anything else clickable in it sits above with z-10.
const LIST = "overflow-hidden rounded-os-card bg-os-card divide-y divide-border";
const ROW =
  "relative flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-os-card-hover";
const ROW_LINK =
  "block truncate text-sm font-medium text-foreground after:absolute after:inset-0";

export default function PortalApplications() {
  const { educationApps, hiring } = useLoaderData<typeof loader>();
  const isEmpty = hiring.length === 0 && educationApps.length === 0;

  return (
    <div className="px-4 sm:px-6 py-10 flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-4xl font-medium text-foreground">
          My applications
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xl">
          Your DALI Lab and course applications in one place.
        </p>
      </header>

      {isEmpty ? (
        <div className="rounded-os-card bg-os-card p-8 text-center">
          <p className="font-heading font-semibold text-foreground">
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
              <ul className={LIST}>
                {hiring.map((app) => (
                  <li key={app.id} className={ROW}>
                    <div className="min-w-0">
                      <Link to={app.href} className={ROW_LINK}>
                        {app.cycleName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Application {app.applicationStatus.toLowerCase()}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {app.domains.map((d) => {
                        const st = HIRING_STATUS[d.status];
                        return (
                          <Pill outline key={d.id} dot={st?.dot ?? "neutral"}>
                            {d.domainName} · {st?.label ?? d.status}
                          </Pill>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {educationApps.length > 0 && (
            <section>
              <h2 className={SECTION_HEADING}>Courses</h2>
              <ul className={LIST}>
                {educationApps.map((a) => (
                  <li key={a.id} className={ROW}>
                    <div className="min-w-0">
                      <Link to={`/portal/education/${a.offeringId}`} className={ROW_LINK}>
                        {a.offeringTitle}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.offeringType}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.certificateId && (
                        <Link
                          to={`/education/certificates/${a.certificateId}`}
                          className="relative z-10 text-xs font-semibold text-os-accent hover:underline"
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
