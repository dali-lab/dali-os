import { useEffect, useState } from "react";
import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.home";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { listPublishedOfferings } from "~/education/lib/offerings-data";
import { listApplicationsForUser } from "~/education/lib/applications-data";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import { OfferingCard } from "~/education/components/OfferingCard";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";

export const meta: Route.MetaFunction = () => [{ title: "Home · DALI" }];

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  // Cycle lookup: active first, fall back to user's most recent application's cycle.
  // This preserves post-cycle outcome visibility — accepted/rejected applicants still
  // see their outcome after the cycle closes (same fallback as portal.tsx lines 42-80).
  const active = await getActiveCycle();
  let cycleId: string | null = null;
  let cycleName: string | null = null;
  let cycleStatus: ApplicationCycleStatus | null = null;
  let closeDate: string | null = null;
  let originalCloseDate: string | null = null;

  if (active) {
    cycleId = active.id;
    cycleName = active.name;
    cycleStatus = active.currentStatus as ApplicationCycleStatus;
    closeDate = active.closeDate ? active.closeDate.toISOString() : null;
    originalCloseDate = active.originalCloseDate
      ? active.originalCloseDate.toISOString()
      : null;
  } else {
    const recentApp = await prisma.application.findFirst({
      where: { userId: auth.user.sub },
      include: {
        applicationCycle: {
          include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recentApp) {
      cycleId = recentApp.applicationCycleId;
      cycleName = recentApp.applicationCycle.name;
      cycleStatus = (recentApp.applicationCycle.statusUpdates[0]?.newStatus ??
        "Draft") as ApplicationCycleStatus;
      closeDate = recentApp.applicationCycle.closeDate
        ? recentApp.applicationCycle.closeDate.toISOString()
        : null;
      originalCloseDate = recentApp.applicationCycle.originalCloseDate
        ? recentApp.applicationCycle.originalCloseDate.toISOString()
        : null;
    }
  }

  // Parallel: lightweight application summary + education data.
  // Application query is skipped (null) when there is no cycle at all.
  const [application, offeringsRaw, myEduApps] = await Promise.all([
    cycleId
      ? prisma.application.findFirst({
          where: { userId: auth.user.sub, applicationCycleId: cycleId },
          include: {
            statusUpdates: { orderBy: { createdAt: "desc" } },
            _count: { select: { domainApplications: { where: { selected: true } } } },
          },
        })
      : Promise.resolve(null),
    listPublishedOfferings(),
    listApplicationsForUser(auth.user.sub),
  ]);

  // Derive application-level status
  let applicationStatus: string | null = null;
  let domainCount = 0;
  let outcome: "Accepted" | "Waitlisted" | "Rejected" | null = null;

  if (application) {
    const updates = application.statusUpdates as { newStatus: string }[];
    const latestNewStatus = updates[0]?.newStatus;
    applicationStatus =
      latestNewStatus === "Withdrawn"
        ? "Withdrawn"
        : updates.some((u) => u.newStatus === "Submitted")
          ? "Submitted"
          : "Draft";
    domainCount = (application._count as { domainApplications: number }).domainApplications;

    // Derive post-cycle outcome from released decisions — only meaningful when
    // the cycle is no longer Open.
    if (applicationStatus === "Submitted" && cycleStatus !== "Open") {
      const releasedDecisions = await prisma.decision.findMany({
        where: {
          domainApplication: {
            application: { userId: auth.user.sub, applicationCycleId: cycleId! },
            selected: true,
          },
          stage: "Released",
        },
        select: { type: true },
      });
      const types = releasedDecisions.map((d) => d.type as string);
      if (types.includes("Accepted")) outcome = "Accepted";
      else if (types.includes("Waitlisted")) outcome = "Waitlisted";
      else if (types.length > 0) outcome = "Rejected";
    }
  }

  // Education: build offering status map and enrolled list with next session
  const myStatusByOffering = new Map<string, string>();
  for (const a of myEduApps) myStatusByOffering.set(a.offering.id, a.status);

  const approvedApps = myEduApps.filter((a) => a.status === "Approved");
  const enrolled = await Promise.all(
    approvedApps.map(async (a) => {
      const nextSession = await prisma.educationSession.findFirst({
        where: { offeringId: a.offering.id, datetime: { gte: new Date() } },
        orderBy: { datetime: "asc" },
        select: { datetime: true },
      });
      return {
        id: a.offering.id,
        title: a.offering.title,
        type: a.offering.type as string,
        nextSessionAt: nextSession?.datetime.toISOString() ?? null,
      };
    }),
  );

  return {
    firstName: auth.user.firstName ?? null,
    // `cycle` is null only when the user has never applied AND there is no active cycle.
    // In that case the Application section is hidden entirely per spec.
    cycle: cycleId
      ? {
          id: cycleId,
          name: cycleName!,
          status: cycleStatus! as string,
          closeDate,
          originalCloseDate,
          hasApplication: !!application,
          applicationStatus,
          domainCount,
          outcome,
        }
      : null,
    offerings: offeringsRaw.map((o) => ({
      id: o.id,
      title: o.title,
      type: o.type as string,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
      capacity: o.capacity,
      approvedCount: o._count.applications,
      registrationClosesAt: o.registrationClosesAt.toISOString(),
      myStatus: (myStatusByOffering.get(o.id) ?? null) as
        | "Submitted"
        | "Approved"
        | "Waitlisted"
        | "Rejected"
        | "Withdrawn"
        | null,
    })),
    enrolled,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type CycleData = NonNullable<LoaderData["cycle"]>;
type OfferingData = LoaderData["offerings"][number];
type EnrolledData = LoaderData["enrolled"][number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

// SSR-safe deadline date display — renders after hydration to use the browser
// locale/timezone without producing an SSR/CSR text mismatch.
function HubDeadlineBit({ closeDate }: { closeDate: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(
      new Date(closeDate).toLocaleDateString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
      }),
    );
  }, [closeDate]);
  if (!label) return null;
  return <span className="text-muted-foreground"> · Deadline {label}</span>;
}

// ─── Application section ──────────────────────────────────────────────────────

function outcomePillClasses(outcome: CycleData["outcome"]): string {
  if (outcome === "Accepted") return "bg-green-100 text-green-700";
  if (outcome === "Waitlisted") return "bg-yellow-100 text-yellow-800";
  return "bg-muted text-muted-foreground";
}

function outcomeLabel(outcome: CycleData["outcome"]): string {
  if (outcome === "Accepted") return "Accepted ✓";
  if (outcome === "Waitlisted") return "Waitlisted";
  return "Not accepted";
}

function ApplicationSection({ cycle }: { cycle: CycleData }) {
  const isOpen = cycle.status === "Open";

  return (
    <section>
      <h2 className="font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
        Application
      </h2>
      <div className="rounded-2xl bg-brand-tint px-6 py-5">
        {/* No application yet */}
        {!cycle.hasApplication && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <span className="font-semibold text-dark-blue">{cycle.name}</span>
              {isOpen ? (
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                  Open
                </span>
              ) : (
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Closed
                </span>
              )}
              {isOpen && cycle.closeDate && (
                <HubDeadlineBit closeDate={cycle.closeDate} />
              )}
            </div>
            {isOpen ? (
              <Link
                to="/portal/apply"
                className="shrink-0 px-5 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
              >
                Start Application →
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground italic">
                Applications are closed for this cycle.
              </span>
            )}
          </div>
        )}

        {/* Draft — started but not submitted */}
        {cycle.applicationStatus === "Draft" && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <span className="font-semibold text-dark-blue">{cycle.name}</span>
              <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">
                In Progress
              </span>
              {isOpen && cycle.closeDate && (
                <HubDeadlineBit closeDate={cycle.closeDate} />
              )}
            </div>
            <Link
              to="/portal/apply"
              className="shrink-0 px-5 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
            >
              Continue Application →
            </Link>
          </div>
        )}

        {/* Submitted */}
        {cycle.applicationStatus === "Submitted" && (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <span className="font-semibold text-dark-blue">{cycle.name}</span>
              {isOpen ? (
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                  Open
                </span>
              ) : (
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Closed
                </span>
              )}
              {!isOpen && cycle.outcome && (
                <span
                  className={`ml-2 text-xs font-semibold px-2.5 py-0.5 rounded-full ${outcomePillClasses(cycle.outcome)}`}
                >
                  {outcomeLabel(cycle.outcome)}
                </span>
              )}
              {isOpen && cycle.closeDate && (
                <HubDeadlineBit closeDate={cycle.closeDate} />
              )}
              <p className="text-sm text-muted-foreground mt-1.5">
                {cycle.domainCount > 0
                  ? `${cycle.domainCount} domain${cycle.domainCount === 1 ? "" : "s"} submitted`
                  : "Submitted — awaiting domain selection"}
              </p>
            </div>
            <Link
              to="/portal/application"
              className="shrink-0 text-sm font-semibold text-accent-coral hover:underline"
            >
              View application →
            </Link>
          </div>
        )}

        {/* Withdrawn */}
        {cycle.applicationStatus === "Withdrawn" && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <span className="font-semibold text-dark-blue">{cycle.name}</span>
              <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                Withdrawn
              </span>
            </div>
            <Link
              to="/portal/application"
              className="shrink-0 text-sm font-semibold text-accent-coral hover:underline"
            >
              View your submission →
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Education section ────────────────────────────────────────────────────────

function EnrolledRow({ course }: { course: EnrolledData }) {
  const [nextLabel, setNextLabel] = useState<string | null>(null);
  useEffect(() => {
    if (course.nextSessionAt) {
      setNextLabel(
        new Date(course.nextSessionAt).toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      );
    }
  }, [course.nextSessionAt]);

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <p className="font-semibold text-dark-blue truncate">{course.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {nextLabel ? `Next session: ${nextLabel}` : "No upcoming sessions"}
        </p>
      </div>
      <Link
        to={`/portal/education/${course.id}/enrolled`}
        className="shrink-0 text-sm font-semibold text-accent-coral hover:underline"
      >
        Go to course →
      </Link>
    </div>
  );
}

function EducationSection({
  enrolled,
  offerings,
}: {
  enrolled: EnrolledData[];
  offerings: OfferingData[];
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Education
        </h2>
        <Link to="/portal/education" className="text-xs text-accent-coral hover:underline">
          Browse all →
        </Link>
      </div>

      {/* Enrolled courses */}
      {enrolled.length > 0 && (
        <div className="rounded-2xl bg-brand-tint px-6 py-2 mb-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground pt-3 pb-2">
            You&apos;re enrolled in
          </p>
          {enrolled.map((c) => (
            <EnrolledRow key={c.id} course={c} />
          ))}
        </div>
      )}

      {/* Open offerings grid */}
      {offerings.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Nothing open right now — check back soon.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {offerings.map((o) => (
            <li key={o.id}>
              <OfferingCard
                id={o.id}
                title={o.title}
                type={o.type as "Miniseries" | "Workshop"}
                startsAt={o.startsAt}
                endsAt={o.endsAt}
                capacity={o.capacity}
                approvedCount={o.approvedCount}
                registrationClosesAt={o.registrationClosesAt}
                enrolledStatus={o.myStatus}
                hrefPrefix="/portal/education"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PortalHome() {
  const data = useLoaderData<typeof loader>();
  const { firstName, cycle, offerings, enrolled } = data;

  const greeting = firstName ? `Hi ${firstName} —` : "Welcome —";

  return (
    <div className="px-6 md:px-16 lg:px-24 py-10 max-w-3xl mx-auto space-y-10">
      <h1 className="font-heading text-2xl font-bold text-dark-blue">{greeting}</h1>

      {cycle && <ApplicationSection cycle={cycle} />}

      <EducationSection enrolled={enrolled} offerings={offerings} />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} secondaryAction={{ kind: "reload" }} />;
}
