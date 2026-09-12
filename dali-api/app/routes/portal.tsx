import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { listCatalog, registrationOpen } from "~/education/lib/offerings.server";
import { listUpcomingSessionsForUser } from "~/education/lib/schedule.server";
import { buttonClasses } from "~/components/ui/Button";
import { useFeatureFlag } from "~/components/FeatureFlags";
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

  const [cycle, offerings, me, upcomingSessions, instructorAssignments] =
    await Promise.all([
      getActiveCycle(),
      listCatalog(auth.user.sub),
      prisma.user.findUnique({
        where: { id: auth.user.sub },
        select: { timeZone: true },
      }),
      listUpcomingSessionsForUser(auth.user.sub, { limit: 3 }),
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
  // Portal students can't set a timezone yet — Eastern is the safe default for
  // a Dartmouth cohort.
  const tz = me?.timeZone ?? "America/New_York";

  // Hiring summary: the latest status update on my application in the active
  // cycle (Draft → Submitted → Withdrawn), if any.
  let applicationStatus: string | null = null;
  if (cycle) {
    const application = await prisma.application.findFirst({
      where: { userId: auth.user.sub, applicationCycleId: cycle.id },
      select: {
        statusUpdates: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { newStatus: true },
        },
      },
    });
    applicationStatus = application?.statusUpdates[0]?.newStatus ?? null;
  }

  const enrolled = offerings.filter((o) => o.myStatus === "Approved");
  // Every education application ever (any status, including offerings that have
  // since dropped from the live catalog) — drives the "My applications" card.
  const educationAppCount = await prisma.educationApplication.count({
    where: { applicantUserId: auth.user.sub },
  });
  return {
    firstName: auth.user.firstName ?? null,
    // The redesigned home shows a "My applications" card whenever the student
    // has applied to anything — DALI hiring or an education offering.
    hasAnyApplication: educationAppCount > 0 || applicationStatus != null,
    educationAppCount,
    hiring: {
      cycleName: cycle?.name ?? null,
      cycleOpen: cycle?.currentStatus === "Open",
      // Formatted server-side (locale + zone pinned, matching the tracker's
      // deadline line) and only while Open — a lapsed date reads as nonsense.
      closesOn:
        cycle?.currentStatus === "Open" && cycle.closeDate
          ? cycle.closeDate.toLocaleDateString("en-US", {
              timeZone: "America/New_York",
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : null,
      applicationStatus,
    },
    education: {
      openOfferings: offerings.filter((o) => registrationOpen(o)).length,
      enrolledCount: enrolled.length,
      pendingCount: offerings.filter(
        (o) => o.myStatus === "Submitted" || o.myStatus === "Waitlisted",
      ).length,
      openAssignments: enrolled.reduce((sum, o) => sum + o.openAssignments, 0),
      upcoming: upcomingSessions.map((s) => ({
        id: s.id,
        offeringId: s.offeringId,
        label: s.title
          ? `${s.offeringTitle} · ${s.title}`
          : `${s.offeringTitle} · Session ${s.sequence}`,
        when: s.datetime.toLocaleString("en-US", {
          timeZone: tz,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        location: s.location,
      })),
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
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border border-border rounded-xl p-6 flex flex-col gap-3 shadow-brand-1">
      <div>
        <h2 className="font-heading text-lg font-bold text-dark-blue">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{blurb}</p>
      </div>
      <div className="mt-auto flex flex-col gap-2">{children}</div>
    </section>
  );
}

// A project-hub-style action card: a gradient cover with a centered emoji, then
// a title + one-line blurb, the whole tile a link. Mirrors the project cards'
// cover-led look on the semantic tokens so it renders on the light portal.
function PortalActionCard({
  to,
  emoji,
  title,
  blurb,
}: {
  to: string;
  emoji: string;
  title: string;
  blurb: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-brand-1 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.3,1)] hover:shadow-brand-2 hover:duration-200 motion-safe:hover:-translate-y-1"
    >
      <div className="flex h-[116px] items-center justify-center overflow-hidden bg-gradient-to-br from-accent-coral/30 via-accent-coral/15 to-accent-green/20">
        <span
          className="text-4xl leading-none transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.08]"
          aria-hidden
        >
          {emoji}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-[17px]">
        <span className="font-heading text-lg font-bold text-dark-blue">{title}</span>
        <span className="text-sm text-muted-foreground">{blurb}</span>
      </div>
    </Link>
  );
}

// The redesigned home's cards, each conditional on live state — an empty list
// (no cycle, nothing open, no apps, no courses) falls back to a single note.
function buildActionCards(
  hiring: PortalData["hiring"],
  education: PortalData["education"],
  teaching: PortalData["teaching"],
  hasAnyApplication: boolean,
  educationAppCount: number,
): { key: string; to: string; emoji: string; title: string; blurb: string }[] {
  const cards: { key: string; to: string; emoji: string; title: string; blurb: string }[] = [];

  if (hiring.cycleOpen) {
    const closes = hiring.closesOn ? ` until ${hiring.closesOn}` : "";
    cards.push({
      key: "apply-dali",
      to: "/portal/apply",
      emoji: "📝",
      title: hiring.applicationStatus === "Draft" ? "Finish your application" : "Apply to DALI",
      blurb:
        hiring.applicationStatus === "Draft"
          ? `You have a draft for ${hiring.cycleName}. Submit it${hiring.closesOn ? ` before ${hiring.closesOn}` : ""}.`
          : hiring.applicationStatus === "Submitted"
            ? `You've applied to ${hiring.cycleName} — you can still edit${closes}.`
            : `The ${hiring.cycleName} cycle is open${closes}.`,
    });
  }

  if (education.openOfferings > 0) {
    cards.push({
      key: "apply-offering",
      to: "/portal/education",
      emoji: "🎓",
      title: "Apply to an offering",
      blurb: `${education.openOfferings} ${education.openOfferings === 1 ? "workshop or miniseries is" : "workshops and miniseries are"} open for registration.`,
    });
  }

  if (hasAnyApplication) {
    const parts: string[] = [];
    if (hiring.applicationStatus) parts.push("1 DALI");
    if (educationAppCount > 0)
      parts.push(`${educationAppCount} course${educationAppCount === 1 ? "" : "s"}`);
    cards.push({
      key: "my-applications",
      to: "/portal/applications",
      emoji: "📋",
      title: "My applications",
      blurb: parts.length
        ? `${parts.join(" · ")} — track status and next steps.`
        : "Track your applications and next steps.",
    });
  }

  if (education.enrolledCount > 0) {
    const due =
      education.openAssignments > 0
        ? ` · ${education.openAssignments} assignment${education.openAssignments === 1 ? "" : "s"} due`
        : "";
    cards.push({
      key: "my-courses",
      to: "/portal/education",
      emoji: "📚",
      title: "My courses",
      blurb: `${education.enrolledCount} in progress${due}.`,
    });
  }

  if (teaching.offerings.length > 0) {
    cards.push({
      key: "teaching",
      to:
        teaching.offerings.length === 1
          ? `/education/manage/${teaching.offerings[0].id}`
          : "/education/manage",
      emoji: "🧑‍🏫",
      title: "Teaching",
      blurb:
        teaching.offerings.length === 1
          ? `Manage ${teaching.offerings[0].title} — sessions, applications, and grading.`
          : `Manage ${teaching.offerings.length} offerings — sessions, applications, and grading.`,
    });
  }

  return cards;
}

// The loader also returns a redirect Response on the member path; exclude it so
// the card-builder can index the data shape.
type PortalData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;

export default function PortalHome() {
  const { firstName, hiring, education, teaching, hasAnyApplication, educationAppCount } =
    useLoaderData<typeof loader>();
  const redesign = useFeatureFlag("education-redesign-v2");
  const actionCards = buildActionCards(
    hiring,
    education,
    teaching,
    hasAnyApplication,
    educationAppCount,
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-3xl font-bold text-dark-blue">
          {firstName ? `Hey ${firstName} 👋` : "Welcome to DALI"}
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xl">
          Everything you can do with the DALI Lab lives here — apply to join
          the lab, or take one of our workshops and miniseries. No lab
          membership required.
        </p>
      </header>

      {redesign ? (
        actionCards.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <p className="font-heading font-semibold text-dark-blue">
              Nothing active right now
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              New application cycles, workshops, and miniseries are posted here
              each term — check back soon.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-6">
            {actionCards.map((c) => (
              <PortalActionCard
                key={c.key}
                to={c.to}
                emoji={c.emoji}
                title={c.title}
                blurb={c.blurb}
              />
            ))}
          </div>
        )
      ) : (
      <div className="grid gap-5 sm:grid-cols-2">
        <CardShell
          title="Apply to DALI"
          blurb={
            hiring.cycleName
              ? hiring.applicationStatus === "Submitted"
                ? `Your ${hiring.cycleName} application is in — track its status and book interviews.`
                : hiring.applicationStatus === "Draft"
                  ? `You have a draft application for ${hiring.cycleName} — finish it before the cycle closes${hiring.closesOn ? ` on ${hiring.closesOn}` : ""}.`
                  : hiring.cycleOpen
                    ? `The ${hiring.cycleName} cycle is open.`
                    : `The ${hiring.cycleName} cycle is under review.`
              : "No application cycle is open right now — check back at the start of term."
          }
        >
          {hiring.applicationStatus ? (
            <Link to="/portal/hiring" className={buttonClasses("primary", "sm")}>
              {hiring.applicationStatus === "Draft"
                ? "Finish my application"
                : "Track my application"}
            </Link>
          ) : hiring.cycleOpen ? (
            <Link to="/portal/apply" className={buttonClasses("primary", "sm")}>
              Start an application
            </Link>
          ) : (
            <Link to="/portal/hiring" className={buttonClasses("secondary", "sm")}>
              View past applications
            </Link>
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
            <Link to="/portal/education" className={buttonClasses("primary", "sm")}>
              {education.enrolledCount > 0 ? "My courses" : "Browse offerings"}
            </Link>
            {education.openAssignments > 0 && (
              <span className="inline-flex items-center rounded-full bg-accent-coral text-white px-2.5 py-1 text-xs font-semibold">
                {education.openAssignments} assignment
                {education.openAssignments === 1 ? "" : "s"} due
              </span>
            )}
            {education.pendingCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-xs font-semibold">
                {education.pendingCount} application{education.pendingCount === 1 ? "" : "s"} pending
              </span>
            )}
          </div>
          {education.upcoming.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
              {education.upcoming.map((s) => (
                <li key={s.id} className="text-xs">
                  <Link
                    to={`/portal/education/${s.offeringId}/hub`}
                    className="font-medium text-dark-blue hover:underline"
                  >
                    {s.label}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {s.when}
                    {s.location ? ` · ${s.location}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
              className={buttonClasses("primary", "sm")}
            >
              {teaching.offerings.length === 1
                ? "Manage my offering"
                : "Manage offerings"}
            </Link>
          </CardShell>
        )}
      </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} />;
}
