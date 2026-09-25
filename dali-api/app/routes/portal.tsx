import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { maybeUpgradeLegacyToBetterAuth } from "~/lib/betterauth-upgrade.server";
import { redirectToLogin } from "~/lib/login-next";
import { getActiveCycles } from "~/hiring/lib/cycles";
import { applicantPortalPath } from "~/hiring/lib/applicant-groups";
import { listCatalog, registrationOpen } from "~/education/lib/offerings.server";
import { listUpcomingSessionsForUser } from "~/education/lib/schedule.server";
import { buttonClasses } from "~/components/ui/Button";
import { MetaList } from "~/components/ui/MetaList";
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

  // TEMPORARY (remove ~1 week post-cutover): migrate a validated legacy session
  // to a BetterAuth session, then reload so the new cookie takes effect.
  const upgradeHeaders = await maybeUpgradeLegacyToBetterAuth(request, auth);
  if (upgradeHeaders) {
    const u = new URL(request.url);
    return redirect(u.pathname + u.search, { headers: upgradeHeaders });
  }

  const [cycles, offerings, me, upcomingSessions, instructorAssignments] =
    await Promise.all([
      getActiveCycles({ applicants: "Students" }),
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

  // Hiring summary: the latest status on my application in each active cycle
  // (Draft → Submitted → Withdrawn). Several cycles can be active at once; the
  // card leads with the one I've applied to, else the first open one.
  const [myActiveApps, hiringAppCount] = await Promise.all([
    prisma.application.findMany({
      where: { userId: auth.user.sub, applicationCycleId: { in: cycles.map((c) => c.id) } },
      select: {
        applicationCycleId: true,
        statusUpdates: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { newStatus: true },
        },
      },
    }),
    prisma.application.count({ where: { userId: auth.user.sub } }),
  ]);
  const statusByCycle = new Map(
    myActiveApps.map((a) => [a.applicationCycleId, a.statusUpdates[0]?.newStatus ?? null]),
  );
  const cycle =
    cycles.find((c) => statusByCycle.get(c.id)) ??
    cycles.find((c) => c.currentStatus === "Open") ??
    cycles[0] ??
    null;
  const applicationStatus = cycle ? (statusByCycle.get(cycle.id) ?? null) : null;
  // Formatted server-side (locale + zone pinned, matching the tracker's
  // deadline line) and only while Open — a lapsed date reads as nonsense.
  const closesOnFor = (c: (typeof cycles)[number]) =>
    c.currentStatus === "Open" && c.closeDate
      ? c.closeDate.toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;

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
    hasAnyApplication: educationAppCount > 0 || hiringAppCount > 0,
    educationAppCount,
    hiring: {
      cycleName: cycle?.name ?? null,
      cycleOpen: cycle?.currentStatus === "Open",
      closesOn: cycle ? closesOnFor(cycle) : null,
      applicationStatus,
      applyHref: cycle ? applicantPortalPath("Students", cycle.id) : "/portal/apply",
      trackHref: cycle ? `/portal/hiring?cycle=${cycle.id}` : "/portal/hiring",
      // Every open cycle, for one Apply card each.
      openCycles: cycles
        .filter((c) => c.currentStatus === "Open")
        .map((c) => ({
          id: c.id,
          name: c.name,
          closesOn: closesOnFor(c),
          applicationStatus: statusByCycle.get(c.id) ?? null,
          applyHref: applicantPortalPath("Students", c.id),
        })),
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

// A flat action tile that shares the education catalog card's language: a
// teal-tinted emoji tile and title up top, the card's facts as labelled rows
// beneath a hairline, the whole thing a link. On the semantic tokens so it reads
// on the light portal, and on the shared MetaList so a deadline or a count looks
// the same wherever the portal shows one. h-full + a bottom-pinned meta block
// keep a row of cards even and their facts aligned.
function PortalActionCard({
  to,
  emoji,
  title,
  meta,
}: {
  to: string;
  emoji: string;
  title: string;
  meta: { label: string; value: string }[];
}) {
  return (
    <Link
      to={to}
      className="group flex h-full flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-brand-1 transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.2,0.8,0.3,1)] hover:border-accent-coral/40 hover:shadow-brand-2 hover:duration-200 motion-safe:hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-teal/10 text-2xl leading-none"
          aria-hidden
        >
          {emoji}
        </span>
        <span className="font-heading text-lg font-bold text-dark-blue transition-colors group-hover:text-accent-coral">
          {title}
        </span>
      </div>
      <div className="mt-auto border-t border-border pt-4">
        <MetaList rows={meta} />
      </div>
    </Link>
  );
}

// The redesigned home's cards, each conditional on live state — an empty list
// (no cycle, nothing open, no apps, no courses) falls back to a single note.
// Each card carries labelled facts rather than a sentence: the deadline, the
// count and the status are what a student is actually scanning for.
type ActionCard = {
  key: string;
  to: string;
  emoji: string;
  title: string;
  meta: { label: string; value: string }[];
};

function buildActionCards(
  hiring: PortalData["hiring"],
  education: PortalData["education"],
  teaching: PortalData["teaching"],
  hasAnyApplication: boolean,
  educationAppCount: number,
): ActionCard[] {
  const cards: ActionCard[] = [];

  for (const open of hiring.openCycles) {
    const meta: { label: string; value: string }[] = [];
    meta.push({ label: "Cycle", value: open.name });
    meta.push({
      label: "Status",
      value:
        open.applicationStatus === "Draft"
          ? "Draft — not submitted"
          : open.applicationStatus === "Submitted"
            ? "Submitted"
            : "Not started",
    });
    if (open.closesOn) {
      meta.push({
        // A submitted application can still be edited up to the close date; an
        // unstarted one has that long to be filed at all.
        label: open.applicationStatus === "Submitted" ? "Edit until" : "Closes",
        value: open.closesOn,
      });
    }
    cards.push({
      key: `apply-dali-${open.id}`,
      to: open.applyHref,
      emoji: "📝",
      title:
        open.applicationStatus === "Draft"
          ? "Finish your application"
          : "Apply to DALI",
      meta,
    });
  }

  if (education.openOfferings > 0) {
    cards.push({
      key: "apply-offering",
      to: "/portal/education",
      emoji: "🎓",
      title: "Apply to an offering",
      meta: [
        {
          label: "Open now",
          value: `${education.openOfferings} workshop${education.openOfferings === 1 ? "" : "s"} & miniseries`,
        },
        ...(education.pendingCount > 0
          ? [{ label: "Awaiting review", value: `${education.pendingCount}` }]
          : []),
      ],
    });
  }

  if (hasAnyApplication) {
    const meta: { label: string; value: string }[] = [];
    if (hiring.applicationStatus)
      meta.push({ label: "DALI", value: hiring.applicationStatus });
    if (educationAppCount > 0)
      meta.push({
        label: "Offerings",
        value: `${educationAppCount} application${educationAppCount === 1 ? "" : "s"}`,
      });
    cards.push({
      key: "my-applications",
      to: "/portal/applications",
      emoji: "📋",
      title: "My applications",
      meta: meta.length
        ? meta
        : [{ label: "Status", value: "Track status and next steps" }],
    });
  }

  if (education.enrolledCount > 0) {
    cards.push({
      key: "my-courses",
      to: "/portal/education",
      emoji: "📚",
      title: "My courses",
      meta: [
        { label: "In progress", value: `${education.enrolledCount}` },
        ...(education.openAssignments > 0
          ? [
              {
                label: "Assignments due",
                value: `${education.openAssignments}`,
              },
            ]
          : []),
      ],
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
      meta: [
        teaching.offerings.length === 1
          ? { label: "Offering", value: teaching.offerings[0].title }
          : { label: "Offerings", value: `${teaching.offerings.length}` },
        { label: "Manage", value: "Sessions, applications, grading" },
      ],
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 pb-10 flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-3xl font-bold text-dark-blue">
          {firstName ? `What are you here to do today, ${firstName}? 👋` : "Welcome to DALI"}
        </h1>
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
                meta={c.meta}
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
            <Link to={hiring.trackHref} className={buttonClasses("primary", "sm")}>
              {hiring.applicationStatus === "Draft"
                ? "Finish my application"
                : "Track my application"}
            </Link>
          ) : hiring.cycleOpen ? (
            <Link to={hiring.applyHref} className={buttonClasses("primary", "sm")}>
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
