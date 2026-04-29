import { useState, useEffect } from "react";
import { Form, Link, useLoaderData } from "react-router";
import { redirect } from "react-router";
import type { Route } from "./+types/domain-lead";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { CheckCircle, Plus, Trash2, Check, Clock, X, CircleDashed, ChevronDown } from "lucide-react";
import { inferDomainApplicationStatus } from "~/lib/domain-application-status";
import { getReviewStatus } from "~/lib/review-status";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import {
  summarizeDecisionPills,
  synthesizePrePipelinePill,
  type DecisionPill,
  type PrePipelinePill,
} from "~/lib/decision-pills";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import { formatVersionLabel, buildVersionNumberMap } from "~/lib/formatVersion";

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

export const meta: Route.MetaFunction = () => [{ title: "Domain lead · DALI OS" }];

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
              challengeVersion: {
                include: {
                  challenge: true,
                  domain: true,
                  createdBy: { select: { firstName: true, lastName: true } },
                },
              },
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
                  // Scheduled drives status inference; Completed feeds the
                  // pre-decision "Post-interview" pill in the table.
                  // Cancelled rows stay filtered out (audit-only).
                  interviews: { where: { status: { in: ["Scheduled", "Completed"] } } },
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

      if (!activeCycle) return [{ assignment, cycle: null, apps: [], challengeVersionOptions: [], linkedChallengeVersions: [], isChallengeReady: false, interviews: [], reviewers: [], delibsSessions: [], draftDecisions: [], cycleReviewersForDomain: [], initialDelibsCount: 0, finalDelibsCount: 0, rubricVersionOptions: [], currentRubricVersionId: null, rubricCriteria: [], interviewers: [], hasApplicationReviews: false }];

      return [await (async (cycle) => {

      // Challenge versions available for this domain
      const challengeVersionOptionsRaw = await prisma.challengeVersion.findMany({
        where: { domainId: assignment.domainId },
        include: { challenge: true, createdBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      });

      // Challenge versions linked to this domain in this cycle (may be 0, 1, or many)
      const linkedChallengeVersionsRaw = cycle.challengeVersions
        .filter((cv) => cv.challengeVersion.domainId === assignment.domainId)
        .map((cv) => cv.challengeVersion);

      // Derive a 1-based versionNumber for each ChallengeVersion by ranking
      // siblings within the same `challengeId` ascending by createdAt.
      // ChallengeVersion has no versionNumber column (RubricVersion does), so
      // we compute it here for symmetry in the picker labels.
      const cvFamilyIds = new Set<string>([
        ...challengeVersionOptionsRaw.map((cv) => cv.challengeId),
        ...linkedChallengeVersionsRaw.map((cv) => cv.challengeId),
      ]);
      const cvSiblings = cvFamilyIds.size > 0
        ? await prisma.challengeVersion.findMany({
            where: { challengeId: { in: [...cvFamilyIds] } },
            select: { id: true, challengeId: true, createdAt: true },
          })
        : [];
      const cvNumberMap = buildVersionNumberMap(cvSiblings);
      const challengeVersionOptions = challengeVersionOptionsRaw.map((cv) => ({
        ...cv,
        versionNumber: cvNumberMap.get(cv.id) ?? null,
      }));
      const linkedChallengeVersions = linkedChallengeVersionsRaw.map((cv) => ({
        ...cv,
        versionNumber: cvNumberMap.get(cv.id) ?? null,
      }));

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

      // Rubric options — rubrics are not domain-specific, so all rubric versions are eligible.
      const rubricVersionOptions = await prisma.rubricVersion.findMany({
        include: { rubric: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
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

      return { assignment, cycle, apps: appsWithStatus, challengeVersionOptions, linkedChallengeVersions, isChallengeReady, interviews, reviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, initialDelibsCount, finalDelibsCount, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews };
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

  if (intent === "add-challenge") {
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

    // Confirm the chosen version belongs to the named domain — guard against
    // form tampering linking a different domain's challenge.
    const cv = await prisma.challengeVersion.findUnique({ where: { id: newVersionId } });
    if (!cv || cv.domainId !== domainId) {
      return redirect("/domain-lead");
    }

    // Prevent linking two versions of the same underlying challenge in one cycle.
    const sameChallenge = await prisma.challengeVersionApplicationCycle.findFirst({
      where: {
        applicationCycleId: cycleId,
        challengeVersion: { challengeId: cv.challengeId, domainId },
      },
    });
    if (sameChallenge) {
      return redirect("/domain-lead");
    }

    // Idempotent: skip if already linked.
    const existing = await prisma.challengeVersionApplicationCycle.findUnique({
      where: { challengeVersionId_applicationCycleId: { challengeVersionId: newVersionId, applicationCycleId: cycleId } },
    });
    if (!existing) {
      await prisma.challengeVersionApplicationCycle.create({
        data: { challengeVersionId: newVersionId, applicationCycleId: cycleId },
      });
    }
    return redirect("/domain-lead");
  }

  if (intent === "remove-challenge") {
    const cycleId = formData.get("cycleId") as string;
    const versionId = formData.get("challengeVersionId") as string;

    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect("/domain-lead");
    }

    // Refuse to remove if any DomainApplication in this cycle picked this CV.
    const inUse = await prisma.domainApplication.count({
      where: {
        challengeVersionId: versionId,
        application: { applicationCycleId: cycleId },
      },
    });
    if (inUse > 0) {
      return redirect("/domain-lead");
    }

    await prisma.challengeVersionApplicationCycle.deleteMany({
      where: { challengeVersionId: versionId, applicationCycleId: cycleId },
    });
    return redirect("/domain-lead");
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

function Section({ title, badge, defaultOpen = true, children }: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between bg-muted/50 hover:bg-muted transition text-left"
      >
        <span className="font-semibold text-foreground text-sm">{title}</span>
        <div className="flex items-center gap-2">
          {badge}
          <ChevronDown className={`w-4 h-4 text-muted-foreground/70 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && <div className="p-5 border-t border-border">{children}</div>}
    </div>
  );
}

function StatPill({ label, value, color = "text-foreground" }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className={`font-semibold ${color}`}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
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

      {domainData.map(({ assignment, cycle, apps, challengeVersionOptions, linkedChallengeVersions, isChallengeReady, interviews, reviewers: cycleReviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, initialDelibsCount, finalDelibsCount, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews }: any, idx: number) => {
        const hasLinkedChallenge = (linkedChallengeVersions ?? []).length > 0;
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
                <div className="px-4 sm:px-6 py-4 border-b border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="text-xl font-semibold text-foreground">{assignment.domain.name}</h2>
                      <span className="text-muted-foreground/70 hidden sm:inline">·</span>
                      <span className="text-lg text-muted-foreground">{cycle.name}</span>
                      {currentStatus && (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[currentStatus]}`}>
                          {STATUS_LABELS[currentStatus]}
                        </span>
                      )}
                    </div>
                    {currentStatus !== "Draft" && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <StatPill label="submitted" value={apps.length} />
                        {fullyReviewed > 0 && <StatPill label="reviewed" value={fullyReviewed} color="text-green-700" />}
                        {withDecisions > 0 && <StatPill label="decided" value={withDecisions} color="text-blue-700" />}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{STATUS_MESSAGES[currentStatus]}</p>
                </div>

                <div className="p-4 sm:p-6 space-y-4">
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
                          linkedChallengeVersions={linkedChallengeVersions ?? []}
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
                          <Link to="/challenges" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            {hasLinkedChallenge ? "Manage Challenges →" : "Create Challenge →"}
                          </Link>
                          <Link to="/rubrics" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            Manage Rubrics →
                          </Link>
                        </div>
                      </div>
                    </Section>
                  )}

                  {/* Setup — just the domain challenges (read-only after Draft) */}
                  {currentStatus !== "Draft" && (currentStatus === "Open" || currentStatus === "UnderReview") && (
                    <Section
                      title="Setup"
                      badge={
                        hasLinkedChallenge
                          ? <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">Configured</span>
                          : <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full font-medium">Needs attention</span>
                      }
                      defaultOpen={!hasLinkedChallenge}
                    >
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                            Domain Challenge{(linkedChallengeVersions ?? []).length > 1 ? "s" : ""}
                          </h4>
                          {hasLinkedChallenge ? (
                            <ul className="space-y-1">
                              {linkedChallengeVersions.map((cv: any) => (
                                <li key={cv.id} className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                    <Link
                                      to={`/challenges/${cv.challengeId}?versionId=${cv.id}`}
                                      className="text-blue-600 hover:text-blue-800"
                                    >
                                      {cv.challenge?.name ?? "Linked"}
                                    </Link>
                                    {hasApplicationReviews && (
                                      <span className="text-xs text-gray-400 ml-1">(locked — reviewers have been assigned)</span>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
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
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
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
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
                              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                              <table className="w-full text-sm border border-border rounded-lg overflow-hidden min-w-[640px]">
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

function DraftSection({ cycle, domainId, challengeVersionOptions, linkedChallengeVersions, isChallengeReady, currentRubricVersionId }: {
  cycle: any;
  domainId: string;
  challengeVersionOptions: any[];
  linkedChallengeVersions: any[];
  isChallengeReady: boolean;
  currentRubricVersionId: string | null;
}) {
  const hasLinkedChallenge = linkedChallengeVersions.length > 0;
  const totalQuestions = linkedChallengeVersions.reduce(
    (sum: number, cv: any) => sum + ((cv.questions as any[])?.length ?? 0),
    0,
  );

  // State 3: At least one challenge linked and marked ready — "Challenge Questions Finalized"
  if (hasLinkedChallenge && isChallengeReady) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-foreground">Challenge Questions Finalized</h3>
          <p className="text-muted-foreground text-sm max-w-sm">
            {linkedChallengeVersions.length === 1
              ? `Your ${linkedChallengeVersions[0]?.challenge?.name ?? "challenge"} has ${totalQuestions} question${totalQuestions !== 1 ? "s" : ""} configured and is ready for applicants.`
              : `${linkedChallengeVersions.length} challenges are configured (${totalQuestions} questions total). Applicants will pick one when they apply.`}
          </p>
        </div>

        <div className="w-full max-w-sm bg-muted/50 border border-border rounded-xl p-4 text-left space-y-3">
          <ul className="text-sm text-foreground/80 space-y-1">
            {linkedChallengeVersions.map((cv: any) => (
              <li key={cv.id} className="flex items-center justify-between">
                <Link
                  to={`/challenges/${cv.challengeId}?versionId=${cv.id}`}
                  className="text-blue-600 hover:text-blue-800"
                >
                  {cv.challenge?.name ?? "Untitled"}
                </Link>
                <span className="text-xs text-muted-foreground">{(cv.questions as any[])?.length ?? 0} questions</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium pt-1 border-t border-border">
            <CheckCircle className="w-4 h-4" />
            Ready for applications
          </div>
        </div>

        <Form method="post">
          <input type="hidden" name="intent" value="unmark-ready" />
          <input type="hidden" name="cycleId" value={cycle.id} />
          <input type="hidden" name="domainId" value={domainId} />
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-lg hover:bg-muted/50"
          >
            Edit Challenges
          </button>
        </Form>
      </div>
    );
  }

  // State 2: Challenges linked but not yet marked ready — "Ready to finalize?"
  if (hasLinkedChallenge && !isChallengeReady) {
    return (
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 space-y-4">
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-blue-900">Ready to finalize?</h3>
              <p className="text-sm text-blue-700 leading-relaxed">
                Once you mark your challenges as ready, your challenge questions will be locked in and visible to applicants when applications open. You can still return here to make edits before the application deadline.
              </p>
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="mark-ready" />
            <input type="hidden" name="cycleId" value={cycle.id} />
            <input type="hidden" name="domainId" value={domainId} />
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
            >
              <CheckCircle className="w-4 h-4" />
              Mark Configuration as Ready
            </button>
          </Form>
        </div>

        <ChallengeSelector
          cycleId={cycle.id}
          domainId={domainId}
          options={challengeVersionOptions}
          linkedChallengeVersions={linkedChallengeVersions}
        />
      </div>
    );
  }

  // State 1: No challenge linked yet
  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Configure Challenges</h3>
        <p className="text-sm text-muted-foreground mt-0.5">Add one or more challenge versions for {cycle.name}. Applicants will pick which one to complete when there is more than one.</p>
      </div>
      <ChallengeSelector
        cycleId={cycle.id}
        domainId={domainId}
        options={challengeVersionOptions}
        linkedChallengeVersions={linkedChallengeVersions}
      />
    </div>
  );
}

function ChallengeSelector({ cycleId, domainId, options, linkedChallengeVersions }: {
  cycleId: string;
  domainId: string;
  options: any[];
  linkedChallengeVersions: any[];
}) {
  const linkedIds = new Set(linkedChallengeVersions.map((cv: any) => cv.id));
  const linkedChallengeIds = new Set(linkedChallengeVersions.map((cv: any) => cv.challengeId));
  const availableOptions = options.filter((cv: any) => !linkedIds.has(cv.id) && !linkedChallengeIds.has(cv.challengeId));
  const [pickerId, setPickerId] = useState<string>("");

  return (
    <div className="space-y-3 pt-1">
      {linkedChallengeVersions.length > 0 && (
        <div className="border border-border rounded-md divide-y divide-gray-100">
          {linkedChallengeVersions.map((cv: any) => {
            const questions: any[] = (cv.questions as any[]) ?? [];
            return (
              <div key={cv.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {formatVersionLabel({
                        name: cv.challenge?.name ?? "Untitled",
                        versionNumber: cv.versionNumber,
                        createdAt: cv.createdAt,
                        createdBy: cv.createdBy,
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {questions.length} question{questions.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove-challenge" />
                    <input type="hidden" name="cycleId" value={cycleId} />
                    <input type="hidden" name="challengeVersionId" value={cv.id} />
                    <button
                      type="submit"
                      aria-label={`Remove ${cv.challenge?.name ?? "challenge"}`}
                      className="text-muted-foreground hover:text-red-600 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Form>
                </div>
                {!isEmptyDoc(cv.description) && (
                  <div className="mt-2 border border-border rounded-md bg-muted/30 px-4 py-3">
                    <RichTextViewer content={cv.description} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {availableOptions.length > 0 ? (
        <Form method="post" className="flex items-end gap-3">
          <input type="hidden" name="intent" value="add-challenge" />
          <input type="hidden" name="cycleId" value={cycleId} />
          <input type="hidden" name="domainId" value={domainId} />
          <div className="flex-1">
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Add Challenge
            </label>
            <select
              name="challengeVersionId"
              value={pickerId}
              onChange={(e) => setPickerId(e.target.value)}
              className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled>Select a challenge…</option>
              {availableOptions.map((cv: any) => (
                <option key={cv.id} value={cv.id}>
                  {formatVersionLabel({
                    name: cv.challenge?.name ?? "Untitled",
                    versionNumber: cv.versionNumber,
                    createdAt: cv.createdAt,
                    createdBy: cv.createdBy,
                  })}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={!pickerId}
            className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </Form>
      ) : linkedChallengeVersions.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">
          No challenge versions exist for this domain yet.
        </p>
      ) : null}
    </div>
  );
}

function ReviewerSection({ cycleId, domainId, initialReviewers }: {
  cycleId: string;
  domainId: string;
  initialReviewers: any[];
}) {
  const [reviewers, setReviewers] = useState(initialReviewers);
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');

  useEffect(() => {
    fetch('/api/members', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => {});
  }, []);

  async function addReviewer() {
    if (!selectedMemberId) return;
    const res = await fetch(`/api/cycles/${cycleId}/reviewers`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daliMemberId: selectedMemberId, domainId, isLead: false }),
    });
    if (res.ok) {
      const reviewer = await res.json();
      setReviewers(prev => [...prev, reviewer]);
      setSelectedMemberId('');
    }
  }

  async function removeReviewer(reviewerId: string) {
    const res = await fetch(`/api/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) setReviewers(prev => prev.filter(r => r.id !== reviewerId));
  }

  // Filter out members already assigned as reviewers for this domain
  const existingMemberIds = new Set(reviewers.map((r: any) => r.daliMemberId));
  const availableMembers = members.filter(m => !existingMemberIds.has(m.id));

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/50">
        <h3 className="font-semibold text-foreground">Reviewers for this Domain ({reviewers.length})</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Add Reviewer</label>
            <select
              value={selectedMemberId}
              onChange={e => setSelectedMemberId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select member...</option>
              {availableMembers.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail ?? m.id}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={addReviewer}
            disabled={!selectedMemberId}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {reviewers.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {reviewers.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-foreground">
                  {r.daliMember?.firstName && r.daliMember?.lastName ? `${r.daliMember.firstName} ${r.daliMember.lastName}` : r.daliMember?.daliEmail ?? r.daliMemberId}
                </span>
                <button onClick={() => removeReviewer(r.id)} className="text-red-500 hover:text-red-700">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70 text-center py-3">No reviewers assigned yet.</p>
        )}
      </div>
    </div>
  );
}

function RubricPicker({ cycleId, domainId, options, selectedId, locked }: {
  cycleId: string;
  domainId: string;
  options: any[];
  selectedId: string | null;
  locked: boolean;
}) {
  const selectedRv = options.find((rv: any) => rv.id === selectedId);
  const selectedLabel = selectedRv
    ? formatVersionLabel({
        name: selectedRv.rubric?.name ?? 'Rubric',
        versionNumber: selectedRv.versionNumber,
        createdAt: selectedRv.createdAt,
        createdBy: selectedRv.createdBy,
      })
    : 'Set';
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/50">
        <h3 className="font-semibold text-foreground">Domain Rubric</h3>
      </div>
      <div className="p-4">
        {locked ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{selectedLabel}</span>
            <span className="text-xs text-muted-foreground/70 ml-2">(locked — reviewers have been assigned)</span>
          </div>
        ) : (
          <Form method="post" key={`rubric-${selectedId}`} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <input type="hidden" name="intent" value="set-rubric" />
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="domainId" value={domainId} />
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Rubric Version</label>
              <select
                name="rubricVersionId"
                defaultValue={selectedId ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">No rubric assigned</option>
                {options.map((rv: any) => (
                  <option key={rv.id} value={rv.id}>
                    {formatVersionLabel({
                      name: rv.rubric?.name ?? 'Rubric',
                      versionNumber: rv.versionNumber,
                      createdAt: rv.createdAt,
                      createdBy: rv.createdBy,
                    })}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
            >
              Save
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}

function InterviewerSection({ cycleId, domainId, initialInterviewers }: {
  cycleId: string;
  domainId: string;
  initialInterviewers: any[];
}) {
  const [interviewers, setInterviewers] = useState(initialInterviewers);
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");

  useEffect(() => {
    fetch("/api/members", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => {});
  }, []);

  async function addInterviewer() {
    if (!selectedMemberId) return;
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daliMemberId: selectedMemberId, domainId }),
    });
    if (res.ok) {
      const interviewer = await res.json();
      const member = members.find((m: any) => m.id === selectedMemberId);
      setInterviewers(prev => [...prev, { ...interviewer, daliMember: member, availabilityHours: 0 }]);
      setSelectedMemberId("");
    }
  }

  async function removeInterviewer(interviewerId: string) {
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: "DELETE", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewerId }),
    });
    if (res.ok) setInterviewers(prev => prev.filter(i => i.id !== interviewerId));
  }

  const existingMemberIds = new Set(interviewers.map((i: any) => i.daliMemberId));
  const availableMembers = members.filter(m => !existingMemberIds.has(m.id));

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/50">
        <h3 className="font-semibold text-foreground">Interviewers for this Domain ({interviewers.length})</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Add Interviewer</label>
            <select
              value={selectedMemberId}
              onChange={e => setSelectedMemberId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select member...</option>
              {availableMembers.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail ?? m.id}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={addInterviewer}
            disabled={!selectedMemberId}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {interviewers.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {interviewers.map((i: any) => {
              const m = i.daliMember;
              const name = m?.firstName && m?.lastName
                ? `${m.firstName} ${m.lastName}`
                : m?.daliEmail ?? i.daliMemberId;
              const hours = i.availabilityHours ?? 0;
              const hasAvailability = hours > 0;
              const hoursLabel =
                Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
              return (
                <div key={i.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">{name}</span>
                    {hasAvailability ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3" />
                        {hoursLabel} available
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted/50 border border-border px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        No availability
                      </span>
                    )}
                  </div>
                  <button onClick={() => removeInterviewer(i.id)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70 text-center py-3">No interviewers assigned yet.</p>
        )}
      </div>
    </div>
  );
}

function DelibsSection({ cycleId, domainId, sessions, initialCount, finalCount }: {
  cycleId: string;
  domainId: string;
  sessions: any[];
  initialCount: number;
  finalCount: number;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  const initialSession = sessions.find((s: any) => s.type === "Initial");
  const finalSession = sessions.find((s: any) => s.type === "Final");

  async function openDelibs(type: "Initial" | "Final") {
    setLoading(type);
    const res = await fetch(`/api/cycles/${cycleId}/delibs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId, type }),
    });
    if (res.ok) {
      const session = await res.json();
      window.location.href = `/domain-lead/delibs/${session.id}`;
    }
    setLoading(null);
  }

  function renderButton(type: "Initial" | "Final", session: any) {
    const count = type === "Initial" ? initialCount : finalCount;
    const countBadge = ` (${count} applicant${count !== 1 ? "s" : ""})`;

    if (session?.status === "Active") {
      return (
        <a
          href={`/domain-lead/delibs/${session.id}`}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
        >
          Continue {type} Delibs{countBadge}
        </a>
      );
    }
    if (session?.status === "Closed") {
      return (
        <button
          onClick={() => openDelibs(type)}
          disabled={loading === type || count === 0}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white transition disabled:opacity-50"
        >
          {loading === type ? "Reopening..." : `Reopen ${type} Delibs${countBadge}`}
        </button>
      );
    }
    return (
      <button
        onClick={() => openDelibs(type)}
        disabled={loading === type || count === 0}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
      >
        {loading === type ? "Starting..." : `Start ${type} Delibs${countBadge}`}
      </button>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/50">
        <h3 className="font-semibold text-foreground">Deliberations</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Initial Delibs</p>
            <p className="text-xs text-muted-foreground">Review applications and decide who advances to interviews</p>
          </div>
          {renderButton("Initial", initialSession)}
        </div>
        <div className="border-t border-border pt-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Final Delibs</p>
            <p className="text-xs text-muted-foreground">Post-interview decisions: accept, waitlist, or reject</p>
          </div>
          {renderButton("Final", finalSession)}
        </div>
      </div>
    </div>
  );
}

const DECISION_COLORS: Record<string, string> = {
  Rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  InvitedToInterview: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Accepted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Waitlisted: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
};

const DECISION_LABELS: Record<string, string> = {
  Rejected: "Reject",
  InvitedToInterview: "Interview",
  Accepted: "Accept",
  Waitlisted: "Waitlist",
};

// Draft pills are rendered with reduced opacity + dashed border to read as
// "tentative", Final pills get a solid border, Released pills are full strength.
const STAGE_TREATMENT: Record<DecisionPill["stage"], string> = {
  Draft: "opacity-60 border border-dashed border-current/40",
  Final: "border border-current/30",
  Released: "",
};

function DecisionPillBadge({ pill }: { pill: DecisionPill }) {
  const baseLabel = DECISION_LABELS[pill.type] ?? pill.type;
  const rankSuffix =
    pill.type === "Waitlisted" && pill.waitlistRank != null
      ? ` #${pill.waitlistRank}`
      : "";
  const stageSuffix = ` (${pill.stage.toLowerCase()})`;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${DECISION_COLORS[pill.type] ?? "bg-muted text-muted-foreground"} ${STAGE_TREATMENT[pill.stage]}`}>
      {baseLabel}{rankSuffix}{stageSuffix}
    </span>
  );
}

const PRE_PIPELINE_LABELS: Record<PrePipelinePill, string> = {
  Reviewing: "Reviewing",
  InterviewScheduled: "Interview scheduled",
  PostInterview: "Post-interview",
};

function PrePipelinePillBadge({ pill }: { pill: PrePipelinePill }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      {PRE_PIPELINE_LABELS[pill]}
    </span>
  );
}

function ApplicationsTable({ apps, draftDecisions, cycleReviewersForDomain, cycleId, domainId, currentStatus, canAssignReviewers, rubricCriteria }: {
  apps: any[];
  draftDecisions: any[];
  cycleReviewersForDomain: any[];
  cycleId: string;
  domainId: string;
  currentStatus: string;
  canAssignReviewers: boolean;
  rubricCriteria: any[];
}) {
  const isUnderReview = currentStatus === "UnderReview";
  const [filter, setFilter] = useState<"all" | "finalize">("all");

  const draftDecisionAppIds = new Set(
    draftDecisions
      .filter((d: any) => {
        const da = apps.flatMap((a: any) => a.domainApplications).find((da: any) => da?.id === d.domainApplicationId);
        if (!da) return false;
        const hasFinal = (da.decisions ?? []).some((dec: any) => dec.stage === "Final");
        return !hasFinal;
      })
      .map((d: any) => {
        const da = apps.flatMap((a: any) => a.domainApplications).find((da: any) => da?.id === d.domainApplicationId);
        return da?.applicationId;
      })
      .filter(Boolean),
  );

  const finalizableApps = apps.filter((app: any) => {
    const da = app.domainApplications[0];
    if (!da) return false;
    const decisions = da.decisions ?? [];
    return decisions.some((d: any) => {
      if (d.stage !== "Draft") return false;
      return !decisions.some(
        (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
      );
    });
  });

  const displayedApps = filter === "finalize" ? finalizableApps : apps;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border bg-muted/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {isUnderReview ? (
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                  filter === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                All Applicants ({apps.length})
              </button>
              <button
                onClick={() => setFilter("finalize")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                  filter === "finalize" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                Needs Finalization ({finalizableApps.length})
              </button>
            </div>
          ) : (
            <h3 className="font-semibold text-foreground">Applications ({apps.length})</h3>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isUnderReview && filter === "finalize" && finalizableApps.length > 0 && (
            <button
              onClick={async () => {
                for (const app of finalizableApps) {
                  const da = app.domainApplications[0];
                  const allDecisions = da?.decisions ?? [];
                  const draft = allDecisions.find((d: any) => {
                    if (d.stage !== "Draft") return false;
                    return !allDecisions.some(
                      (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
                    );
                  });
                  if (draft) {
                    await fetch(`/api/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
                  }
                }
                window.location.reload();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition"
            >
              Finalize All ({finalizableApps.length})
            </button>
          )}
          {currentStatus === "UnderReview" && (
            <button
              onClick={async () => {
                const res = await fetch(`/api/cycles/${cycleId}/domains/${domainId}/auto-assign`, {
                  method: "POST", credentials: "include",
                });
                if (res.ok) {
                  window.location.reload();
                } else {
                  const body = await res.json().catch(() => ({}));
                  alert(body.error ?? "Auto-assign failed. Check that rubrics are set and reviewers are added.");
                }
              }}
              disabled={!canAssignReviewers || cycleReviewersForDomain.length === 0}
              title={
                !canAssignReviewers
                  ? "Set both domain and general rubrics before assigning reviewers"
                  : cycleReviewersForDomain.length === 0
                    ? "Add reviewers to this domain first"
                    : undefined
              }
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
            >
              Auto-Assign Reviewers
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="px-6 py-3 text-left">Applicant</th>
            <th className="px-6 py-3 text-left">Reviewers</th>
            <th className="px-6 py-3 text-left">Decisions</th>
            <th className="px-6 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {displayedApps.map((app: any) => {
            const da = app.domainApplications[0];
            const reviews = da?.reviews ?? [];
            const decisions = da?.decisions ?? [];
            const draftToFinalize = decisions.find((d: any) => {
              if (d.stage !== "Draft") return false;
              return !decisions.some(
                (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
              );
            });
            const pills = da
              ? summarizeDecisionPills({ decisions })
              : [];
            const prePill = da && pills.length === 0
              ? synthesizePrePipelinePill({
                  application: { statusUpdates: app.statusUpdates ?? [] },
                  interviews: da.interviews ?? [],
                  decisions,
                })
              : null;
            return (
              <tr key={app.id} className="hover:bg-muted/50">
                <td className="px-6 py-4 font-medium text-foreground">
                  {app.user.firstName} {app.user.lastName}
                </td>
                <td className="px-6 py-4">
                  <ReviewerAssignmentCell
                    domainApplicationId={da?.id}
                    reviews={reviews}
                    cycleReviewers={cycleReviewersForDomain}
                    editable={isUnderReview && canAssignReviewers}
                    rubricCriteria={rubricCriteria}
                  />
                </td>
                <td className="px-6 py-4">
                  {pills.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {pills.map((pill, i) => (
                        <DecisionPillBadge key={i} pill={pill} />
                      ))}
                    </div>
                  ) : prePill ? (
                    <PrePipelinePillBadge pill={prePill} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                  {isUnderReview && draftToFinalize && (
                    <button
                      onClick={async () => {
                        await fetch(`/api/decisions/${draftToFinalize.id}/finalize`, { method: "POST", credentials: "include" });
                        window.location.reload();
                      }}
                      className="px-2 py-1 text-xs font-medium rounded bg-green-600 hover:bg-green-700 text-white transition"
                    >
                      Finalize
                    </button>
                  )}
                  <Link
                    to={`/domain-lead/application/${da?.id}`}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Review →
                  </Link>
                  </div>
                </td>
              </tr>
            );
          })}
          {displayedApps.length === 0 && (
            <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground/70 text-sm">
              {filter === "finalize" ? "No applications need finalization." : "No applications."}
            </td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function ReviewerAssignmentCell({ domainApplicationId, reviews, cycleReviewers, editable = true, rubricCriteria = [] }: {
  domainApplicationId: string | undefined;
  reviews: any[];
  cycleReviewers: any[];
  editable?: boolean;
  rubricCriteria?: any[];
}) {
  const [localReviews, setLocalReviews] = useState(reviews);
  const [adding, setAdding] = useState(false);
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [openReview, setOpenReview] = useState<any | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const assignedReviewerIds = new Set(localReviews.map((r: any) => r.cycleReviewerId));
  const available = cycleReviewers.filter((cr: any) => !assignedReviewerIds.has(cr.id));

  async function addReviewer() {
    if (!domainApplicationId || !selectedReviewerId) return;
    try {
      const res = await fetch(`/api/domain-applications/${domainApplicationId}/reviews`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleReviewerId: selectedReviewerId }),
      });
      if (res.ok) {
        const review = await res.json();
        const reviewer = cycleReviewers.find((cr: any) => cr.id === selectedReviewerId);
        setLocalReviews(prev => [...prev, { ...review, cycleReviewer: reviewer }]);
        setSelectedReviewerId("");
        setAdding(false);
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to add reviewer:", res.status, err);
        alert(`Failed to add reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to add reviewer:", e);
    }
  }

  async function removeReview(reviewId: string, wasSubmitted: boolean) {
    if (wasSubmitted) {
      const ok = confirm("This reviewer has already submitted their review. Removing them will delete their scores and feedback. Continue?");
      if (!ok) return;
    }
    setRemoving(reviewId);
    try {
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setLocalReviews(prev => prev.filter(r => r.id !== reviewId));
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to remove review:", res.status, err);
        alert(`Failed to remove reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to remove review:", e);
      alert(`Failed to remove reviewer: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {localReviews.map((r: any) => {
        const m = r.cycleReviewer?.daliMember;
        const name = m?.firstName && m?.lastName
          ? `${m.firstName} ${m.lastName[0]}.`
          : m?.daliEmail ?? "?";
        const status = getReviewStatus(r);
        const pillClass =
          status === "submitted"
            ? "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300"
            : status === "inProgress"
              ? "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
              : "border-gray-300 bg-muted/50 text-muted-foreground dark:border-gray-700 dark:bg-gray-800 dark:text-muted-foreground/70";
        const icon =
          status === "submitted" ? (
            <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
          ) : status === "inProgress" ? (
            <Clock className="w-3 h-3 text-yellow-600 dark:text-yellow-400" />
          ) : (
            <CircleDashed className="w-3 h-3 text-muted-foreground/70" />
          );
        return (
          <span
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => setOpenReview(r)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenReview(r);
              }
            }}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border cursor-pointer hover:brightness-95 transition ${pillClass}`}
          >
            {icon}
            {name}
            {editable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeReview(r.id, status === "submitted");
                }}
                disabled={removing === r.id}
                className="ml-0.5 text-muted-foreground/70 hover:text-red-500 transition"
                title={status === "submitted" ? "Remove reviewer (deletes submitted review)" : "Remove reviewer"}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </span>
        );
      })}
      {editable && adding ? (
        <div className="inline-flex items-center gap-1">
          <select
            value={selectedReviewerId}
            onChange={e => setSelectedReviewerId(e.target.value)}
            className="rounded border border-border bg-card text-card-foreground px-1.5 py-0.5 text-xs"
          >
            <option value="">Select...</option>
            {available.map((cr: any) => {
              const m = cr.daliMember;
              const label = m?.firstName && m?.lastName
                ? `${m.firstName} ${m.lastName}`
                : m?.daliEmail ?? cr.id;
              return <option key={cr.id} value={cr.id}>{label}</option>;
            })}
          </select>
          <button
            onClick={addReviewer}
            disabled={!selectedReviewerId}
            className="px-1.5 py-0.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => { setAdding(false); setSelectedReviewerId(""); }}
            className="text-muted-foreground/70 hover:text-muted-foreground"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ) : editable ? (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border border-dashed border-gray-300 text-muted-foreground/70 hover:border-blue-400 hover:text-blue-600 transition"
          title="Add reviewer"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      ) : null}
      {openReview && (
        <ReviewModal
          review={openReview}
          rubricCriteria={rubricCriteria}
          onClose={() => setOpenReview(null)}
        />
      )}
    </div>
  );
}

function ReviewModal({ review, rubricCriteria, onClose }: {
  review: any;
  rubricCriteria: any[];
  onClose: () => void;
}) {
  const m = review.cycleReviewer?.daliMember;
  const reviewerName = m?.firstName && m?.lastName
    ? `${m.firstName} ${m.lastName}`
    : m?.daliEmail ?? "Reviewer";
  const isSubmitted = !!review.submittedAt;
  const scoreEntries = Object.entries((review.scores as Record<string, number>) ?? {});
  const criteriaByKey: Record<string, { label: string }> = {};
  for (const c of rubricCriteria ?? []) {
    if (c?.key) criteriaByKey[c.key] = { label: c.label ?? c.key };
  }

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasAnyContent =
    scoreEntries.length > 0 ||
    (review.feedback && review.feedback.trim() !== "") ||
    (review.rejectionRationale && review.rejectionRationale.trim() !== "") ||
    !!review.overallRecommendation;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-card rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{reviewerName}</h2>
            <div className="mt-1 flex items-center gap-2 text-xs">
              {isSubmitted ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-green-50 text-green-700 border border-green-200">
                  <Check className="w-3 h-3" />
                  Submitted
                  {review.submittedAt && (
                    <span className="text-green-600">
                      · {new Date(review.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  )}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
                  <Clock className="w-3 h-3" />
                  In progress
                </span>
              )}
              {review.overallRecommendation && (
                <span className="px-2 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  {review.overallRecommendation}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-foreground/80 transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {!hasAnyContent ? (
            <p className="text-sm text-muted-foreground italic">
              This reviewer hasn&apos;t started their review yet.
            </p>
          ) : (
            <>
              {scoreEntries.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Scores
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {scoreEntries.map(([key, score]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-2"
                      >
                        <span className="text-foreground/80">
                          {criteriaByKey[key]?.label ?? key}
                        </span>
                        <span className="font-semibold text-foreground">{score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {review.feedback && review.feedback.trim() !== "" && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Feedback
                  </h3>
                  <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 rounded p-3">
                    {review.feedback}
                  </p>
                </div>
              )}
              {review.rejectionRationale && review.rejectionRationale.trim() !== "" && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Rejection rationale
                  </h3>
                  <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 rounded p-3">
                    {review.rejectionRationale}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

