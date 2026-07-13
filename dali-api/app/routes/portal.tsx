import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { listCatalog, registrationOpen } from "~/education/lib/offerings.server";
import { buttonClasses } from "~/components/ui/Button";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";

export const meta: Route.MetaFunction = () => [{ title: "DALI Portal" }];

// The non-member home: a dashboard of everything a Dartmouth student can do
// with DALI right now. Each surface is one card — add future offerings
// (events, alumni programs, …) as new cards here rather than new nav tabs.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  // Lab members have the full app; the portal is the non-member surface.
  if (auth.user.type === "member") return redirect("/");

  const [cycle, offerings] = await Promise.all([
    getActiveCycle(),
    listCatalog(auth.user.sub),
  ]);

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
  return {
    firstName: auth.user.firstName ?? null,
    hiring: {
      cycleName: cycle?.name ?? null,
      cycleOpen: cycle?.currentStatus === "Open",
      applicationStatus,
    },
    education: {
      openOfferings: offerings.filter((o) => registrationOpen(o)).length,
      enrolledCount: enrolled.length,
      pendingCount: offerings.filter(
        (o) => o.myStatus === "Submitted" || o.myStatus === "Waitlisted",
      ).length,
      openAssignments: enrolled.reduce((sum, o) => sum + o.openAssignments, 0),
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

export default function PortalHome() {
  const { firstName, hiring, education } = useLoaderData<typeof loader>();

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

      <div className="grid gap-5 sm:grid-cols-2">
        <CardShell
          title="Apply to DALI"
          blurb={
            hiring.cycleName
              ? hiring.applicationStatus === "Submitted"
                ? `Your ${hiring.cycleName} application is in — track its status and book interviews.`
                : hiring.applicationStatus === "Draft"
                  ? `You have a draft application for ${hiring.cycleName} — finish it before the cycle closes.`
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
        </CardShell>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} />;
}
