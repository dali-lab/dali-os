import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getActiveCycles } from "~/hiring/lib/cycles";
import { applicantPortalPath } from "~/hiring/lib/applicant-groups";
import { cycleDeadlineSummary } from "~/hiring/lib/domain-windows";
import { domainApplicationStatusInclude, inferDomainApplicationStatus } from "~/hiring/lib/domain-application-status";
import { portalCycleCard } from "~/hiring/lib/portal-cycle-card";
import { listCatalog, registrationOpen } from "~/education/lib/offerings.server";
import { Clock } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Meta } from "~/components/AttentionPanel";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";

export const meta: Route.MetaFunction = () => [{ title: "DALI Portal" }];

// The non-member home: a dashboard of everything a Dartmouth student can do
// with DALI right now. Each surface is one card — add future offerings
// (events, alumni programs, …) as new cards here rather than new nav tabs.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  // Lab members have the full app; the portal is the non-member surface.
  if (auth.user.type === "member") return redirect("/");

  // Legacy→BetterAuth session upgrade runs in applicant-layout.tsx (this route's
  // parent layout), which covers every /portal/* route, not just this index.

  const [cycles, offerings, instructorAssignments] =
    await Promise.all([
      getActiveCycles({ applicants: "Students" }),
      listCatalog(auth.user.sub),
      // A non-member can hold instructor assignments (external instructor) — the
      // Teaching card is their door into the management surface.
      prisma.instructorAssignment.findMany({
        where: { userId: auth.user.sub },
        select: { offering: { select: { id: true, title: true } } },
      }),
    ]);
  const teachingOfferings = Array.from(
    new Map(
      instructorAssignments.map((a) => [a.offering.id, a.offering]),
    ).values(),
  );
  // The latest status on my application in each active cycle
  // (Draft → Submitted → Withdrawn). Several cycles can be active at once.
  const [myActiveApps, readyDomainRows] = await Promise.all([
    prisma.application.findMany({
      where: { userId: auth.user.sub, applicationCycleId: { in: cycles.map((c) => c.id) } },
      select: {
        applicationCycleId: true,
        statusUpdates: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { newStatus: true },
        },
        domainApplications: {
          where: { selected: true },
          include: { ...domainApplicationStatusInclude, domain: { select: { name: true } } },
        },
      },
    }),
    prisma.domainApplicationCycle.findMany({
      where: { applicationCycleId: { in: cycles.map((c) => c.id) }, isReady: true },
      select: { applicationCycleId: true, domainId: true, closeDate: true },
    }),
  ]);
  const statusByCycle = new Map(
    myActiveApps.map((a) => [a.applicationCycleId, a.statusUpdates[0]?.newStatus ?? null]),
  );
  const selectedDomainIdsByCycle = new Map(
    myActiveApps.map((a) => [a.applicationCycleId, a.domainApplications.map((da) => da.domainId)]),
  );
  // Each selected domain's status as the tracker derives it, so the home card
  // moves past "Submitted" when a decision or interview lands.
  const domainsByCycle = new Map(
    myActiveApps.map((a) => {
      const cycleStatus = cycles.find((c) => c.id === a.applicationCycleId)?.currentStatus ?? "Draft";
      return [
        a.applicationCycleId,
        a.domainApplications.map((da) => ({
          name: da.domain.name,
          status: inferDomainApplicationStatus(da, cycleStatus),
        })),
      ];
    }),
  );
  const readyDomainsByCycle = new Map<string, { domainId: string; closeDate: Date | null }[]>();
  for (const d of readyDomainRows) {
    const arr = readyDomainsByCycle.get(d.applicationCycleId) ?? [];
    arr.push({ domainId: d.domainId, closeDate: d.closeDate });
    readyDomainsByCycle.set(d.applicationCycleId, arr);
  }
  // Formatted server-side (locale + zone pinned, matching the tracker's
  // deadline line) and only while Open — a lapsed date reads as nonsense. The
  // date shown is the applicant's own deadline once they've applied (their
  // selected domains' latest close), else the latest across every ready
  // domain, flagging when that's not everyone's deadline.
  const closesOnFor = (c: (typeof cycles)[number]) => {
    if (c.currentStatus !== "Open") return null;
    const { closeDate, earlierDomainsExist } = cycleDeadlineSummary(
      readyDomainsByCycle.get(c.id) ?? [],
      c,
      selectedDomainIdsByCycle.get(c.id),
    );
    if (!closeDate) return null;
    const formatted = closeDate.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return earlierDomainsExist ? `${formatted} · some domains close earlier` : formatted;
  };

  // Current courses only: finished or closed-out ones are history, not home.
  const now = new Date();
  const enrolled = offerings.filter(
    (o) =>
      o.myStatus === "Approved" &&
      o.closedOutAt == null &&
      (o.endsAt == null || o.endsAt >= now),
  );
  return {
    firstName: auth.user.firstName ?? null,
    hiring: {
      // Every active cycle, each with its own row and action.
      cycles: cycles.map((c) => ({
        id: c.id,
        name: c.name,
        open: c.currentStatus === "Open",
        closesOn: closesOnFor(c),
        applicationStatus: statusByCycle.get(c.id) ?? null,
        domains: domainsByCycle.get(c.id) ?? [],
        applyHref: applicantPortalPath("Students", c.id),
        trackHref: `/portal/hiring?cycle=${c.id}`,
      })),
    },
    education: {
      openOfferings: offerings.filter((o) => registrationOpen(o)).length,
      enrolledCount: enrolled.length,
      pendingCount: offerings.filter(
        (o) => o.myStatus === "Submitted" || o.myStatus === "Waitlisted",
      ).length,
      openAssignments: enrolled.reduce((sum, o) => sum + o.openAssignments, 0),
    },
    teaching: {
      offerings: teachingOfferings,
    },
  };
}

function CardShell({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-[260px] flex-col gap-5 rounded-os-card bg-os-card p-8">
      <div>
        <h2 className="font-heading text-2xl font-semibold text-foreground">{title}</h2>
        {blurb && <p className="mt-2 text-base text-muted-foreground">{blurb}</p>}
      </div>
      <div className={`${blurb ? "mt-auto" : "flex-1"} flex flex-col gap-2`}>{children}</div>
    </section>
  );
}

type PortalData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type HiringCycle = PortalData["hiring"]["cycles"][number];

// One cycle in the task-card language (AttentionPanel): the name carries the
// weight, a single meta line gives its state.
function CycleInfo({ cycle }: { cycle: HiringCycle }) {
  const { meta } = portalCycleCard(cycle);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-lg font-bold leading-7 text-foreground">{cycle.name}</h3>
      <Meta icon={meta.includes("Due") ? Clock : undefined} text={meta} />
    </div>
  );
}

function CycleAction({ cycle }: { cycle: HiringCycle }) {
  const { action } = portalCycleCard(cycle);
  if (!action) return null;
  return (
    <Link to={action.href} className={buttonClasses("primary", "md")}>
      {action.label}
    </Link>
  );
}

export default function PortalHome() {
  const { firstName, hiring, education, teaching } = useLoaderData<typeof loader>();

  return (
    <div className="px-6 py-10 flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-4xl font-medium text-foreground">
          {firstName ? `What are you here to do today, ${firstName}? 👋` : "Welcome to DALI"}
        </h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <CardShell
          title="Apply to DALI"
          blurb={
            hiring.cycles.length === 0
              ? "No application cycle is open right now. Check back at the start of term."
              : undefined
          }
        >
          {hiring.cycles.length === 0 ? (
            <div>
              <Link to="/portal/hiring" className={buttonClasses("secondary", "md")}>
                View past applications
              </Link>
            </div>
          ) : hiring.cycles.length === 1 ? (
            <>
              <CycleInfo cycle={hiring.cycles[0]} />
              <div className="mt-auto pt-1">
                <CycleAction cycle={hiring.cycles[0]} />
              </div>
            </>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {hiring.cycles.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <CycleInfo cycle={c} />
                  <div className="shrink-0">
                    <CycleAction cycle={c} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardShell>

        <CardShell
          title="Education"
          blurb={
            education.enrolledCount > 0
              ? `You're enrolled in ${education.enrolledCount} course${education.enrolledCount === 1 ? "" : "s"}${
                  education.openAssignments > 0
                    ? ` — ${education.openAssignments} assignment${education.openAssignments === 1 ? "" : "s"} waiting on you`
                    : ""
                }.`
              : education.openOfferings > 0
                ? `${education.openOfferings} workshop${education.openOfferings === 1 ? " or miniseries is" : "s and miniseries are"} open for registration.`
                : "Workshops and miniseries are posted here each term."
          }
        >
          <div className="flex items-center gap-2 flex-wrap">
            {education.enrolledCount > 0 && (
              <Link
                to="/portal/education?tab=courses"
                className={buttonClasses("primary", "md")}
              >
                My courses
              </Link>
            )}
            <Link
              to="/portal/education?tab=browse"
              className={buttonClasses(education.enrolledCount > 0 ? "secondary" : "primary", "md")}
            >
              Browse offerings
            </Link>
            {education.openAssignments > 0 && (
              <span className="inline-flex items-center rounded-full border border-os-container px-3 py-1 text-sm font-medium text-os-grey">
                {education.openAssignments} assignment
                {education.openAssignments === 1 ? "" : "s"} due
              </span>
            )}
            {education.pendingCount > 0 && (
              <span className="inline-flex items-center rounded-full border border-os-container px-3 py-1 text-sm font-medium text-os-grey">
                {education.pendingCount} application{education.pendingCount === 1 ? "" : "s"} pending
              </span>
            )}
          </div>
        </CardShell>

        {teaching.offerings.length > 0 && (
          <CardShell
            title="Teaching"
            blurb={
              teaching.offerings.length === 1
                ? `You're an instructor for ${teaching.offerings[0].title}. Manage sessions, applications, attendance, and grading.`
                : `You're an instructor for ${teaching.offerings.length} offerings. Manage sessions, applications, attendance, and grading.`
            }
          >
            <Link
              to={
                teaching.offerings.length === 1
                  ? `/education/manage/${teaching.offerings[0].id}`
                  : "/education/manage"
              }
              className={buttonClasses("primary", "md")}
            >
              {teaching.offerings.length === 1
                ? "Manage my offering"
                : "Manage offerings"}
            </Link>
          </CardShell>
        )}
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} />;
}
