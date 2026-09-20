import { useCallback } from "react";
import { useLoaderData, useRevalidator, useSearchParams, Link } from "react-router";
import type { Route } from "./+types/portal.hiring";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getActiveCycles } from "~/hiring/lib/cycles";
import { sendExtensionNoticeIfDue } from "~/hiring/lib/extension-notice";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { Confetti } from "~/components/Confetti";
import { resolveUserTimeZone } from "~/lib/timezone";
import { loadApplicationTracker } from "~/hiring/lib/application-tracker.server";
import {
  ApplicationDraftView,
  ApplicationOpenView,
  DeadlineLine,
  DomainApplicationCard,
  PendingView,
  WithdrawnView,
  type DomainAppData,
} from "~/hiring/components/ApplicationTracker";

export const meta: Route.MetaFunction = () => [{ title: "Apply to DALI · DALI OS" }];

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  // The applicant's own zone, used to show interview times as a dual (ET anchor
  // + their local time). Null/unset resolves to ET, so those applicants see the
  // ET-only rendering — the safe default for in-person Dartmouth interviews.
  const viewer = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { timeZone: true },
  });
  const viewerTimeZone = resolveUserTimeZone(viewer);

  const emptyResult = {
    cycleName: null as string | null,
    cycleId: null as string | null,
    cycleStatus: null as string | null,
    cycleChoices: [] as { id: string; name: string }[],
    hasInterviews: true,
    closeDate: null as string | null,
    originalCloseDate: null as string | null,
    domainApplications: [] as any[],
    slotDurationMinutes: 30,
    hasApplication: false,
    applicationStatus: null as string | null,
    viewerTimeZone,
  };

  // Every Students cycle the applicant can look at: the ones they applied to
  // (newest first) plus any active cycle they haven't. Several can be active at
  // once, and an older application must stay reachable after a new cycle opens,
  // so ?cycle=<id> picks one and the header offers the others.
  const [activeCycles, myApplications] = await Promise.all([
    getActiveCycles({ applicants: "Students" }),
    prisma.application.findMany({
      where: { userId: auth.user.sub, applicationCycle: { applicants: "Students" } },
      select: { applicationCycle: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const appliedIds = new Set(myApplications.map((a) => a.applicationCycle.id));
  const cycleChoices = [
    ...myApplications.map((a) => a.applicationCycle),
    ...activeCycles.filter((c) => !appliedIds.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
  ];
  const requested = new URL(request.url).searchParams.get("cycle");
  // Default: an active cycle I applied to, else any active cycle, else my most
  // recent application's cycle (keeps the portal visible after Completed).
  const selectedId =
    (requested && cycleChoices.some((c) => c.id === requested) ? requested : null) ??
    activeCycles.find((c) => appliedIds.has(c.id))?.id ??
    activeCycles[0]?.id ??
    myApplications[0]?.applicationCycle.id;
  if (!selectedId) return emptyResult;

  const selected = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: selectedId },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const active = activeCycles.find((c) => c.id === selectedId);
  const cycleId = selected.id;
  const cycleName = selected.name;
  // Active cycles carry the derived status (Open past its close date reads as
  // UnderReview); others use their latest status row.
  const cycleStatus = (active?.currentStatus ??
    selected.statusUpdates[0]?.newStatus ??
    "Draft") as ApplicationCycleStatus;
  const closeDate = selected.closeDate ? selected.closeDate.toISOString() : null;
  const originalCloseDate = selected.originalCloseDate ? selected.originalCloseDate.toISOString() : null;
  if (active) {
    // Lazy trigger for the extension-notice blast — fires the first time a
    // request hits this loader after the original close has passed (and an
    // extension is in effect). Idempotent and best-effort (errors swallowed
    // inside the function so loader latency is the only cost).
    await sendExtensionNoticeIfDue(cycleId);
  }

  const tracker = await loadApplicationTracker(auth.user.sub, cycleId, cycleStatus);

  return {
      cycleName,
      cycleId,
      cycleStatus,
      cycleChoices,
      hasInterviews: selected.hasInterviews,
      closeDate,
      originalCloseDate,
      ...tracker,
      viewerTimeZone,
    };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Portal() {
  const data = useLoaderData<typeof loader>() as any;
  const {
    cycleName,
    cycleId,
    cycleStatus,
    cycleChoices,
    hasInterviews,
    closeDate,
    originalCloseDate,
    domainApplications,
    slotDurationMinutes,
    hasApplication,
    applicationStatus,
    viewerTimeZone,
  } = data;
  const applyHref = `/portal/apply/${cycleId}`;

  const revalidator = useRevalidator();
  const handleRevalidate = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

  const [searchParams, setSearchParams] = useSearchParams();
  const justSubmitted = searchParams.get("just-submitted") === "1";
  const handleConfettiFire = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("just-submitted");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  if (!cycleId) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center px-6">
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">No Active Cycle</h2>
        <p className="text-muted-foreground">There is no active application cycle right now. Check back later!</p>
      </div>
    );
  }

  const das = domainApplications as DomainAppData[];

  // Determine top-level state when there are no domain applications yet
  let topLevelStage: "ApplicationOpen" | "ApplicationsClosed" | "Pending" | "Draft" | "Withdrawn" | null = null;
  if (applicationStatus === "Withdrawn") {
    // Withdrawal is terminal at the application level — short-circuit per-domain
    // cards regardless of how many DAs the applicant created.
    topLevelStage = "Withdrawn";
  } else if (das.length === 0) {
    if (applicationStatus === "Submitted") {
      topLevelStage = "Pending";
    } else if (!hasApplication && cycleStatus === "Open") {
      topLevelStage = "ApplicationOpen";
    } else if (!hasApplication) {
      topLevelStage = "ApplicationsClosed";
    }
  } else if (applicationStatus === "Draft") {
    topLevelStage = "Draft";
  }

  return (
    <div>
      <Confetti trigger={justSubmitted} onFire={handleConfettiFire} />
      {/* Header */}
      <div className="bg-brand-tint px-6 md:px-16 lg:px-24 py-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-xl font-bold text-dark-blue">
            {cycleName} Application Portal
          </h1>
          {cycleStatus === "Open" && closeDate && <DeadlineLine closeDate={closeDate} originalCloseDate={originalCloseDate} timeZone={viewerTimeZone} />}
          {cycleChoices.length > 1 && (
            <nav aria-label="Cycles" className="mt-4 flex flex-wrap gap-2">
              {(cycleChoices as { id: string; name: string }[]).map((c) => (
                <Link
                  key={c.id}
                  to={`?cycle=${c.id}`}
                  aria-current={c.id === cycleId ? "page" : undefined}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                    c.id === cycleId
                      ? "bg-dark-blue text-white"
                      : "bg-card text-dark-blue border border-border hover:border-dark-blue/40"
                  }`}
                >
                  {c.name}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 md:px-16 lg:px-24 py-10">
        {topLevelStage === "ApplicationsClosed" && (
          <div className="max-w-2xl mx-auto text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
              <svg className="w-8 h-8 text-muted-foreground/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Applications Closed</h2>
            <p className="text-muted-foreground leading-relaxed">
              The application window for {cycleName} has closed. Check back for future application cycles!
            </p>
          </div>
        )}
        {topLevelStage === "ApplicationOpen" && <ApplicationOpenView cycleName={cycleName} applyHref={applyHref} />}
        {topLevelStage === "Pending" && (
          <>
            <PendingView cycleName={cycleName} />
            {cycleStatus === "Open" && (
              <div className="max-w-2xl mx-auto mt-4 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 flex items-center justify-between gap-4">
                <p className="text-sm text-blue-800">
                  The cycle is still open — you can still update your application.
                </p>
                <Link
                  to={applyHref}
                  className="shrink-0 px-4 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
                >
                  Edit Application
                </Link>
              </div>
            )}
          </>
        )}
        {topLevelStage === "Draft" && <ApplicationDraftView cycleName={cycleName} applyHref={applyHref} />}
        {topLevelStage === "Withdrawn" && <WithdrawnView cycleName={cycleName} submissionHref="/portal/application" />}

        {das.length > 0 && applicationStatus !== "Draft" && applicationStatus !== "Withdrawn" && (
          <div className="max-w-3xl mx-auto space-y-8">
            {cycleStatus === "Open" && applicationStatus === "Submitted" && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 flex items-center justify-between gap-4">
                <p className="text-sm text-blue-800">
                  The cycle is still open — you can still update your application.
                </p>
                <Link
                  to={applyHref}
                  className="shrink-0 px-4 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
                >
                  Edit Application
                </Link>
              </div>
            )}
            <div className="flex justify-end">
              <Link to={`/portal/application?cycle=${cycleId}`} className="text-sm text-accent-coral hover:underline">
                View your submission →
              </Link>
            </div>
            {das.map(da => (
              <DomainApplicationCard
                key={da.id}
                da={da}
                cycleId={cycleId}
                cycleName={cycleName}
                hasInterviews={hasInterviews}
                slotDurationMinutes={slotDurationMinutes}
                submissionHref="/portal/application"
                viewerTimeZone={viewerTimeZone}
                onRevalidate={handleRevalidate}
              />
            ))}
          </div>
        )}
      </div>
      <div className="px-6 md:px-16 lg:px-24 py-6 text-center text-xs text-muted-foreground/70">
        Made with ❤️ at the DALI Lab.
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} secondaryAction={{ kind: "reload" }} />;
}
