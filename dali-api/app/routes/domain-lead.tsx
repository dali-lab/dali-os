import { Form, Link, useLoaderData } from "react-router";
import { redirect } from "react-router";
import type { Route } from "./+types/domain-lead";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { CheckCircle, Clock } from "lucide-react";
import { inferDomainApplicationStatus } from "~/lib/domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import { Section, StatPill } from "~/components/domain-lead/primitives";
import { DraftSection } from "~/components/domain-lead/DraftSection";
import { ReviewerSection } from "~/components/domain-lead/ReviewerSection";
import { RubricPicker } from "~/components/domain-lead/RubricPicker";
import { InterviewerSection } from "~/components/domain-lead/InterviewerSection";
import { DelibsSection } from "~/components/domain-lead/DelibsSection";
import { ApplicationsTable } from "~/components/domain-lead/ApplicationsTable";

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Open: "Open",
  UnderReview: "Under Review",
  Completed: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-muted text-foreground/80",
  Open: "bg-green-100 text-green-700",
  UnderReview: "bg-yellow-100 text-yellow-700",
  Completed: "bg-blue-100 text-blue-700",
};

const STATUS_MESSAGES: Record<string, string> = {
  Draft: "This cycle is still being set up.",
  Open: "Applications are open. Applicants can submit until the cycle closes.",
  UnderReview: "Submissions are closed. Review applications below.",
  Completed: "Decisions have been released to applicants.",
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { domainData: [] };

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  });

  if (!member) {
    return { domainData: [] };
  }

  const assignments = await prisma.domainLeadAssignment.findMany({
    where: { memberId: member.id },
    include: { domain: true },
  });

  const domainData = await Promise.all(
    assignments.map(async (assignment) => {
      const allCycles = await prisma.applicationCycle.findMany({
        where: {
          domains: { some: { domainId: assignment.domainId } },
        },
        include: {
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domains: { where: { domainId: assignment.domainId } },
          challengeVersions: {
            include: {
              challengeVersion: { include: { challenge: true, domain: true } },
            },
          },
          applications: {
            include: {
              user: true,
              statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
              domainApplications: {
                where: { challengeVersion: { domainId: assignment.domainId } },
                include: {
                  challengeVersion: { include: { domain: true } },
                  reviews: {
                    include: {
                      cycleReviewer: {
                        include: { daliMember: { select: { firstName: true, lastName: true, daliEmail: true } } },
                      },
                    },
                  },
                  decisions: { orderBy: { createdAt: "desc" } },
                  // Only active interviews (Scheduled). Historical rows
                  // don't contribute to status inference here.
                  interviews: { where: { status: "Scheduled" } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Pick the single most recent cycle — prefer Open/UnderReview over Draft
      const activeCycle = allCycles.find((c) => {
        const status = c.statusUpdates[0]?.newStatus;
        return status && ["Open", "UnderReview"].includes(status);
      }) ?? allCycles.find((c) => {
        const status = c.statusUpdates[0]?.newStatus;
        return status === "Draft";
      }) ?? null;

      if (!activeCycle) return [{ assignment, cycle: null, apps: [], challengeVersionOptions: [], selectedChallengeVersionId: null, isChallengeReady: false, interviews: [], reviewers: [], delibsSessions: [], draftDecisions: [], cycleReviewersForDomain: [], initialDelibsCount: 0, finalDelibsCount: 0, rubricVersionOptions: [], currentRubricVersionId: null, rubricCriteria: [], interviewers: [], hasApplicationReviews: false }];

      return [await (async (cycle) => {

      // Challenge versions available for this domain
      const challengeVersionOptions = await prisma.challengeVersion.findMany({
        where: { domainId: assignment.domainId },
        include: { challenge: true },
        orderBy: { createdAt: "desc" },
      });

      // Currently selected challenge version(s) for this domain in this cycle
      const selectedChallengeVersionId =
        cycle.challengeVersions.find(
          (cv) => cv.challengeVersion.domainId === assignment.domainId
        )?.challengeVersionId ?? null;

      // isReady lives on DomainApplicationCycle (per domain+cycle, not per challenge version)
      const isChallengeReady = cycle.domains[0]?.isReady ?? false;

      const apps = cycle.applications.filter((app) => {
        const latestStatus = app.statusUpdates[0]?.newStatus;
        return latestStatus === "Submitted" && app.domainApplications.length > 0;
      });

      // Interviews for this domain in this cycle. Only Scheduled rows appear
      // in the dashboard table — cancelled rows are audit-only.
      const currentStatus = cycle?.statusUpdates[0]?.newStatus ?? "Draft";
      const interviews = (currentStatus === "UnderReview" || currentStatus === "Completed") && cycle
        ? await prisma.interview.findMany({
            where: {
              applicationCycleId: cycle.id,
              status: "Scheduled",
              domainApplication: {
                challengeVersion: { domainId: assignment.domainId },
              },
            },
            include: {
              domainApplication: {
                include: {
                  application: {
                    include: {
                      user: { select: { firstName: true, lastName: true } },
                    },
                  },
                  challengeVersion: { include: { domain: true } },
                },
              },
              assignments: {
                where: { status: "Active" },
                include: {
                  cycleInterviewer: {
                    include: { daliMember: true, domain: true },
                  },
                },
              },
            },
            orderBy: { startTime: "asc" },
          })
        : [];

      // Reviewers for this domain in this cycle
      const reviewers = cycle
        ? await prisma.cycleReviewer.findMany({
            where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
            include: { daliMember: { include: { user: true } }, domain: true },
          })
        : [];

      // Delibs sessions for this domain+cycle
      const delibsSessions = cycle
        ? await prisma.delibsSession.findMany({
            where: { domainId: assignment.domainId, applicationCycleId: cycle.id },
            orderBy: { createdAt: "desc" },
          })
        : [];

      // Count qualifying applications for each delibs type
      const initialDelibsCount = cycle
        ? await prisma.domainApplication.count({
            where: {
              challengeVersion: { domainId: assignment.domainId },
              application: { applicationCycleId: cycle.id, statusUpdates: { some: { newStatus: "Submitted" } } },
              reviews: { every: { submittedAt: { not: null } }, some: {} },
              decisions: { none: { stage: { in: ["Final", "Released"] } } },
            },
          })
        : 0;

      const finalDelibsCount = cycle
        ? await prisma.domainApplication.count({
            where: {
              challengeVersion: { domainId: assignment.domainId },
              application: { applicationCycleId: cycle.id, statusUpdates: { some: { newStatus: "Submitted" } } },
              interviews: { some: { status: "Completed" } },
            },
          })
        : 0;

      // Compute inferred status for each domain application
      const appsWithStatus = apps.map((app: any) => ({
        ...app,
        domainApplications: app.domainApplications.map((da: any) => ({
          ...da,
          inferredStatus: inferDomainApplicationStatus(
            { ...da, application: { statusUpdates: app.statusUpdates } },
            currentStatus as ApplicationCycleStatus,
          ),
        })),
      }));

      // Draft decisions (for finalization after delibs close)
      const draftDecisions = cycle
        ? await prisma.decision.findMany({
            where: {
              stage: "Draft",
              domainApplication: {
                challengeVersion: { domainId: assignment.domainId },
                application: { applicationCycleId: cycle.id },
              },
            },
            include: {
              domainApplication: {
                include: { application: { include: { user: { select: { firstName: true, lastName: true } } } } },
              },
            },
            orderBy: { createdAt: "desc" },
          })
        : [];

      // Cycle reviewers for this domain (for the reviewer assignment picker)
      const cycleReviewersForDomain = cycle
        ? await prisma.cycleReviewer.findMany({
            where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
            include: { daliMember: { select: { id: true, firstName: true, lastName: true, daliEmail: true } } },
          })
        : [];

      // Rubric options for this domain
      const rubricVersionOptions = await prisma.rubricVersion.findMany({
        where: { rubric: { domainId: assignment.domainId } },
        include: { rubric: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      const currentRubricVersionId = cycle?.domains[0]?.rubricVersionId ?? null;
      const rubricCriteria = (rubricVersionOptions.find((rv) => rv.id === currentRubricVersionId)?.criteria as any[] | null) ?? [];

      // Interviewers for this domain in this cycle (with availability blocks —
      // the component sums their durations to show total hours offered).
      const interviewersRaw = cycle
        ? await prisma.cycleInterviewer.findMany({
            where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
            include: {
              daliMember: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
              availabilityBlocks: { select: { startTime: true, endTime: true } },
            },
          })
        : [];
      const interviewers = interviewersRaw.map((i) => {
        const totalMs = i.availabilityBlocks.reduce(
          (sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()),
          0,
        );
        return {
          ...i,
          availabilityHours: totalMs / (1000 * 60 * 60),
        };
      });
      const hasApplicationReviews = cycle
        ? (await prisma.applicationReview.count({
            where: {
              domainApplication: {
                challengeVersion: { domainId: assignment.domainId },
                application: { applicationCycleId: cycle.id },
              },
            },
          })) > 0
        : false;

      return { assignment, cycle, apps: appsWithStatus, challengeVersionOptions, selectedChallengeVersionId, isChallengeReady, interviews, reviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, initialDelibsCount, finalDelibsCount, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews };
      })(activeCycle)];
    })
  );

  return { domainData: domainData.flat() };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set-rubric") {
    const cycleId = formData.get("cycleId") as string;
    const domainId = formData.get("domainId") as string;
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;

    const hasAssignedReviews = await prisma.applicationReview.count({
      where: {
        domainApplication: {
          challengeVersion: { domainId },
          application: { applicationCycleId: cycleId },
        },
      },
    });
    if (hasAssignedReviews > 0) {
      return redirect("/domain-lead");
    }

    await prisma.domainApplicationCycle.update({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      data: { rubricVersionId },
    });
    return redirect("/domain-lead");
  }

  if (intent === "select-challenge") {
    const cycleId = formData.get("cycleId") as string;
    const newVersionId = formData.get("challengeVersionId") as string;
    const domainId = formData.get("domainId") as string;

    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect("/domain-lead");
    }

    // Remove any existing challenge version for this domain in this cycle
    const existing = await prisma.challengeVersionApplicationCycle.findMany({
      where: {
        applicationCycleId: cycleId,
        challengeVersion: { domainId },
      },
    });
    if (existing.length > 0) {
      await prisma.challengeVersionApplicationCycle.deleteMany({
        where: {
          applicationCycleId: cycleId,
          challengeVersionId: { in: existing.map((e) => e.challengeVersionId) },
        },
      });
    }

    await prisma.challengeVersionApplicationCycle.create({
      data: { challengeVersionId: newVersionId, applicationCycleId: cycleId },
    });
  }

  if (intent === "mark-ready" || intent === "unmark-ready") {
    const cycleId = formData.get("cycleId") as string;
    const domainId = formData.get("domainId") as string;
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect("/domain-lead");
    }
    const isReady = intent === "mark-ready";
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      update: { isReady },
      create: { domainId, applicationCycleId: cycleId, isReady },
    });
    return redirect("/domain-lead");
  }

  return redirect("/domain-lead");
}

export default function DomainLeadDashboard() {
  const data = useLoaderData<typeof loader>() as any;
  const domainData = data?.domainData ?? [];

  if (domainData.length === 0) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold text-foreground mb-2">Domain Lead Dashboard</h1>
        <p className="text-muted-foreground">You are not assigned as a domain lead for any domain.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Domain Lead Dashboard</h1>

      {domainData.map(({ assignment, cycle, apps, challengeVersionOptions, selectedChallengeVersionId, isChallengeReady, interviews, reviewers: cycleReviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, initialDelibsCount, finalDelibsCount, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews }: any, idx: number) => {
        const currentStatus = cycle?.statusUpdates[0]?.newStatus ?? null;

        // Compute stats for progress badges
        const fullyReviewed = apps.filter((a: any) => {
          const da = a.domainApplications?.[0];
          return da?.reviews?.length > 0 && da.reviews.every((r: any) => r.submittedAt);
        }).length;
        const needsReviewers = apps.filter((a: any) => {
          const da = a.domainApplications?.[0];
          return !da?.reviews || da.reviews.length === 0;
        }).length;
        const withDecisions = apps.filter((a: any) => {
          const da = a.domainApplications?.[0];
          return da?.decisions?.some((d: any) => d.stage === "Final" || d.stage === "Released");
        }).length;
        const scheduledInterviews = interviews.filter((i: any) => i.status === "Scheduled").length;
        const completedInterviews = interviews.filter((i: any) => i.status === "Completed").length;

        return (
          <section key={`${assignment.id}-${cycle?.id ?? idx}`} className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            {!cycle ? (
              <div className="p-6">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold text-foreground">{assignment.domain.name}</h2>
                </div>
                <div className="mt-3 bg-muted/50 rounded-lg p-6 text-muted-foreground text-sm">
                  No active cycle for this domain.
                </div>
              </div>
            ) : (
              <>
                {/* Domain header */}
                <div className="px-6 py-4 border-b border-border bg-card">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-semibold text-foreground">{assignment.domain.name}</h2>
                      <span className="text-muted-foreground/70">·</span>
                      <span className="text-lg text-muted-foreground">{cycle.name}</span>
                      {currentStatus && (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[currentStatus]}`}>
                          {STATUS_LABELS[currentStatus]}
                        </span>
                      )}
                    </div>
                    {currentStatus !== "Draft" && (
                      <div className="flex items-center gap-4">
                        <StatPill label="submitted" value={apps.length} />
                        {fullyReviewed > 0 && <StatPill label="reviewed" value={fullyReviewed} color="text-green-700" />}
                        {withDecisions > 0 && <StatPill label="decided" value={withDecisions} color="text-blue-700" />}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{STATUS_MESSAGES[currentStatus]}</p>
                </div>

                <div className="p-6 space-y-4">
                  {/* Setup — Draft only */}
                  {currentStatus === "Draft" && (
                    <Section
                      title="Setup"
                      badge={
                        isChallengeReady && currentRubricVersionId
                          ? <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">Ready</span>
                          : <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full font-medium">Action needed</span>
                      }
                      defaultOpen={!isChallengeReady || !currentRubricVersionId}
                    >
                      <div className="space-y-4">
                        <DraftSection
                          cycle={cycle}
                          domainId={assignment.domainId}
                          challengeVersionOptions={challengeVersionOptions}
                          selectedChallengeVersionId={selectedChallengeVersionId}
                          isChallengeReady={isChallengeReady}
                          currentRubricVersionId={currentRubricVersionId}
                        />
                        <RubricPicker
                          cycleId={cycle.id}
                          domainId={assignment.domainId}
                          options={rubricVersionOptions ?? []}
                          selectedId={currentRubricVersionId}
                          locked={hasApplicationReviews}
                        />
                        <div className="flex items-center gap-3 pt-2 border-t border-border">
                          {selectedChallengeVersionId ? (() => {
                            const cv = challengeVersionOptions.find((c: any) => c.id === selectedChallengeVersionId);
                            return cv?.challenge?.id ? (
                              <Link to={`/challenges/${cv.challenge.id}`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                                Edit Challenge →
                              </Link>
                            ) : null;
                          })() : (
                            <Link to="/challenges" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                              Create Challenge →
                            </Link>
                          )}
                          <Link to="/rubrics" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            Manage Rubrics →
                          </Link>
                        </div>
                      </div>
                    </Section>
                  )}

                  {/* Setup — just the domain challenge */}
                  {currentStatus !== "Draft" && (currentStatus === "Open" || currentStatus === "UnderReview") && (
                    <Section
                      title="Setup"
                      badge={
                        selectedChallengeVersionId
                          ? <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">Configured</span>
                          : <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full font-medium">Needs attention</span>
                      }
                      defaultOpen={!selectedChallengeVersionId}
                    >
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Domain Challenge</h4>
                          {selectedChallengeVersionId ? (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <CheckCircle className="w-4 h-4 text-green-600" />
                                <span>{challengeVersionOptions.find((c: any) => c.id === selectedChallengeVersionId)?.challenge?.name ?? "Linked"}</span>
                                {hasApplicationReviews && (
                                  <span className="text-xs text-gray-400 ml-1">(locked — reviewers have been assigned)</span>
                                )}
                              </div>
                              {!hasApplicationReviews && (() => {
                                const cv = challengeVersionOptions.find((c: any) => c.id === selectedChallengeVersionId);
                                return cv?.challenge?.id ? (
                                  <Link to={`/challenges/${cv.challenge.id}`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                                    Edit →
                                  </Link>
                                ) : null;
                              })()}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground/70">No challenge linked</span>
                              <Link to="/challenges" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                                Create Challenge →
                              </Link>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                          <Link to="/challenges" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            All Challenges →
                          </Link>
                        </div>
                      </div>
                    </Section>
                  )}

                  {/* Reviews — Team + Rubric (editable until reviewers are assigned) */}
                  <Section
                    title="Reviews"
                    badge={
                      <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span>{cycleReviewers.length} reviewers, {(interviewers ?? []).length} interviewers</span>
                        {currentRubricVersionId
                          ? <span className="text-green-700">· rubric set</span>
                          : <span className="text-yellow-700">· no rubric</span>}
                      </div>
                    }
                    defaultOpen={currentStatus === "Draft" || currentStatus === "Open" || !currentRubricVersionId}
                  >
                    <div className="space-y-6">
                      {/* Domain Rubric */}
                      <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Domain Rubric</h4>
                        <RubricPicker
                          cycleId={cycle.id}
                          domainId={assignment.domainId}
                          options={rubricVersionOptions ?? []}
                          selectedId={currentRubricVersionId}
                          locked={hasApplicationReviews}
                        />
                        {!cycle.generalRubricVersionId && (
                          <div className="mt-3 flex items-center gap-2 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
                            <Clock className="w-4 h-4 flex-shrink-0" />
                            <span>Waiting on hiring lead to set the general application rubric — reviewer assignment is blocked until both rubrics are set.</span>
                          </div>
                        )}
                        <div className="mt-2">
                          <Link to="/rubrics" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            All Rubrics →
                          </Link>
                        </div>
                      </div>

                      {/* Team — Reviewers + Interviewers */}
                      <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Team</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <ReviewerSection cycleId={cycle.id} domainId={assignment.domainId} initialReviewers={cycleReviewers} />
                          <InterviewerSection cycleId={cycle.id} domainId={assignment.domainId} initialInterviewers={interviewers ?? []} />
                        </div>
                      </div>
                    </div>
                  </Section>

                  {/* Applications */}
                  {currentStatus !== "Draft" && (
                    <Section
                      title="Applications"
                      badge={
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{apps.length} submitted</span>
                          <span>·</span>
                          <span>{fullyReviewed} reviewed</span>
                          {needsReviewers > 0 && <><span>·</span><span className="text-yellow-700">{needsReviewers} need reviewers</span></>}
                        </div>
                      }
                      defaultOpen={true}
                    >
                      {apps.length > 0 ? (
                        <ApplicationsTable
                          apps={apps}
                          draftDecisions={draftDecisions ?? []}
                          cycleReviewersForDomain={cycleReviewersForDomain}
                          cycleId={cycle.id}
                          domainId={assignment.domainId}
                          currentStatus={currentStatus}
                          canAssignReviewers={!!currentRubricVersionId && !!cycle.generalRubricVersionId}
                          rubricCriteria={rubricCriteria ?? []}
                        />
                      ) : (
                        <div className="text-center text-muted-foreground text-sm py-6">
                          No submitted applications yet.
                        </div>
                      )}
                    </Section>
                  )}

                  {/* Deliberations — UnderReview only */}
                  {currentStatus === "UnderReview" && (
                    <Section
                      title="Deliberations"
                      badge={
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{initialDelibsCount ?? 0} ready for initial</span>
                          <span>·</span>
                          <span>{finalDelibsCount ?? 0} ready for final</span>
                        </div>
                      }
                      defaultOpen={(initialDelibsCount ?? 0) > 0 || (finalDelibsCount ?? 0) > 0}
                    >
                      <DelibsSection cycleId={cycle.id} domainId={assignment.domainId} sessions={delibsSessions ?? []} initialCount={initialDelibsCount ?? 0} finalCount={finalDelibsCount ?? 0} />
                    </Section>
                  )}

                  {/* Interviews — show when any applicant has been invited */}
                  {(() => {
                    const invited = apps.filter((a: any) => {
                      const status = a.domainApplications?.[0]?.inferredStatus;
                      return status === "InvitedToInterview" || status === "InterviewScheduled" || status === "PostInterviewPending";
                    });
                    const awaitingBooking = invited.filter((a: any) => a.domainApplications?.[0]?.inferredStatus === "InvitedToInterview");
                    const hasAnyInterviewActivity = invited.length > 0 || interviews.length > 0;

                    const interviewersWithAvailability = (interviewers ?? []).filter((i: any) => i.availabilityHours > 0);
                    const noAvailability = invited.length > 0 && interviewersWithAvailability.length === 0;

                    return hasAnyInterviewActivity ? (
                      <Section
                        title="Interviews"
                        badge={
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {awaitingBooking.length > 0 && <span className="text-yellow-700">{awaitingBooking.length} awaiting booking</span>}
                            {scheduledInterviews > 0 && <><span>·</span><span>{scheduledInterviews} scheduled</span></>}
                            {completedInterviews > 0 && <><span>·</span><span className="text-green-700">{completedInterviews} completed</span></>}
                          </div>
                        }
                        defaultOpen={true}
                      >
                        <div className="space-y-4">
                          {/* Availability warning */}
                          {noAvailability && (
                            <div className="flex items-center gap-2 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                              <Clock className="w-4 h-4 flex-shrink-0" />
                              <span>No interviewers have set their availability yet. Applicants can't book interviews until interviewers submit availability blocks.</span>
                            </div>
                          )}

                          {/* Awaiting booking */}
                          {awaitingBooking.length > 0 && (
                            <div>
                              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Awaiting Booking</h4>
                              <div className="divide-y divide-gray-100 border border-border rounded-lg">
                                {awaitingBooking.map((app: any) => (
                                  <div key={app.id} className="flex items-center justify-between px-4 py-3">
                                    <span className="text-sm font-medium text-foreground">
                                      {app.user.firstName} {app.user.lastName}
                                    </span>
                                    <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full font-medium">
                                      Invited — not booked
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Scheduled / Completed interviews */}
                          {interviews.length > 0 && (
                            <div>
                              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Booked Interviews</h4>
                              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                                <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                  <tr>
                                    <th className="px-4 py-2 text-left">Applicant</th>
                                    <th className="px-4 py-2 text-left">Time</th>
                                    <th className="px-4 py-2 text-left">Status</th>
                                    <th className="px-4 py-2 text-left">In-Domain</th>
                                    <th className="px-4 py-2 text-left">Cross-Domain</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {interviews.map((interview: any) => {
                                    const start = new Date(interview.startTime);
                                    const end = new Date(interview.endTime);
                                    const formatAssignment = (a: any) => {
                                      const m = a.cycleInterviewer.daliMember;
                                      return m.firstName && m.lastName
                                        ? `${m.firstName} ${m.lastName}`
                                        : m.daliEmail ?? '?';
                                    };
                                    const inDomain = interview.assignments
                                      .filter((a: any) => a.role === 'InDomain' && a.status === 'Active')
                                      .map(formatAssignment)
                                      .join(', ') || '—';
                                    const crossDomain = interview.assignments
                                      .filter((a: any) => a.role === 'CrossDomain' && a.status === 'Active')
                                      .map((a: any) => `${formatAssignment(a)} (${a.cycleInterviewer.domain.name})`)
                                      .join(', ') || '—';
                                    return (
                                      <tr key={interview.id} className="hover:bg-muted/50">
                                        <td className="px-4 py-3 font-medium text-foreground">
                                          {interview.domainApplication.application.user.firstName} {interview.domainApplication.application.user.lastName}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                          {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                                          {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                                          {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                                        </td>
                                        <td className="px-4 py-3">
                                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                                            interview.status === "Completed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                                          }`}>
                                            {interview.status}
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground text-xs">{inDomain}</td>
                                        <td className="px-4 py-3 text-muted-foreground text-xs">{crossDomain}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </Section>
                    ) : null;
                  })()}
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
