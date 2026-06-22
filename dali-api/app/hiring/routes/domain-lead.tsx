import { useState, useEffect } from "react";
import { Form, Link, useLoaderData, useNavigate, useSearchParams, useRevalidator, useSubmit } from "react-router";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { redirect } from "react-router";
import type { Route } from "./+types/domain-lead";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { CheckCircle, Plus, Trash2, Check, Clock, X, CircleDashed, ChevronDown, Eye, Send, Search, ChevronUp } from "lucide-react";
import { inferDomainApplicationStatus } from "~/hiring/lib/domain-application-status";
import { inReviewPipelineFilter } from "~/hiring/lib/application-pipeline-filter";
import { getReviewStatus } from "~/hiring/lib/review-status";
import { buildCriteriaList } from "~/hiring/lib/rubric-criteria";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import { Modal } from "~/components/Modal";
import { ChallengePreviewModal } from "~/hiring/components/ChallengePreviewModal";
import { CycleSelector } from "~/hiring/components/CycleSelector";
import {
  summarizeDecisionPills,
  synthesizePrePipelinePill,
  currentDecisionId,
  type DecisionPill,
  type PrePipelinePill,
} from "~/hiring/lib/decision-pills";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { DecisionType } from "~/types";
import { formatVersionLabel, buildVersionNumberMap } from "~/lib/formatVersion";
import { selectActiveCycleForDomainLead } from "~/hiring/lib/cycle-picker";
import { STATUS_LABELS, DECISION_LABELS, STATUS_COLORS, DECISION_COLORS } from "~/hiring/lib/labels";

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

  const assignments = await prisma.domainLeadAssignment.findMany({
    where: { userId: auth.user.sub },
    include: { domain: true },
  });

  if (assignments.length === 0) {
    return { domainData: [] };
  }

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
                where: {
                  selected: true,
                  // Standard cycles link Domain via challengeVersion; InternToFull
                  // links it directly. OR matches DAs from both cycle types.
                  OR: [
                    { challengeVersion: { domainId: assignment.domainId } },
                    { domainId: assignment.domainId },
                  ],
                },
                include: {
                  challengeVersion: { include: { domain: true } },
                  reviews: {
                    include: {
                      cycleReviewer: {
                        include: { user: { select: { firstName: true, lastName: true, daliEmail: true } } },
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

      // Cycles eligible for the picker: anything Open/UnderReview/Draft for
      // this domain. After cycleType split, a Standard + InternToFull cycle
      // can both be active for the same domain (target domains overlap).
      const candidateCycles = allCycles.filter((c) => {
        const status = c.statusUpdates[0]?.newStatus;
        return status && ["Open", "UnderReview", "Draft"].includes(status);
      });
      const availableCycles = candidateCycles.map((c) => ({
        id: c.id,
        name: c.name,
        cycleType: c.cycleType as string,
      }));

      const requestedCycleId = new URL(request.url).searchParams.get("cycle");
      const activeCycle = selectActiveCycleForDomainLead(candidateCycles, requestedCycleId);

      if (!activeCycle) return [{ assignment, cycle: null, availableCycles, apps: [], challengeVersionOptions: [], linkedChallengeVersions: [], isChallengeReady: false, interviews: [], reviewers: [], delibsSessions: [], draftDecisions: [], cycleReviewersForDomain: [], initialDelibsCount: 0, finalDelibsCount: 0, rubricVersionOptions: [], currentRubricVersionId: null, rubricCriteria: [], interviewers: [], hasApplicationReviews: false, confidentialityRequired: null as null | "no_agreement" | "unsigned" }];

      const confState = await getCycleConfidentialityState(auth.user.sub, activeCycle.id);
      const confidentialityRequired = confState.status === "signed" ? null : confState.status;

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

      // Interviews for this domain in this cycle. Both Scheduled and Completed
      // rows appear in the dashboard table — only cancelled rows are excluded
      // (audit-only). Load for any non-Draft cycle: an interview can be booked
      // while the cycle is still Open (a Released invite + scheduled slot), and
      // those applicants must surface in the Interviews section rather than
      // vanishing (they're excluded from Reviews).
      const currentStatus = cycle?.statusUpdates[0]?.newStatus ?? "Draft";
      const interviews = currentStatus !== "Draft" && cycle
        ? await prisma.interview.findMany({
            where: {
              applicationCycleId: cycle.id,
              status: { in: ["Scheduled", "Completed"] },
              domainApplication: {
                OR: [
                  { challengeVersion: { domainId: assignment.domainId } },
                  { domainId: assignment.domainId },
                ],
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
                    include: { user: true, domain: true },
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
            include: { user: true, domain: true },
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
      const isInternToFull = cycle?.cycleType === "InternToFull";
      // Domain-linkage OR matches DAs whether they're attached via
      // challengeVersion (Standard) or directly (InternToFull).
      const daDomainMatch = {
        OR: [
          { challengeVersion: { domainId: assignment.domainId } },
          { domainId: assignment.domainId },
        ],
      };

      // InternToFull cycles skip the Initial→interview round, so the Initial
      // delibs count is always 0 for them.
      const initialDelibsCount = cycle && !isInternToFull
        ? await prisma.domainApplication.count({
            where: {
              selected: true,
              ...daDomainMatch,
              application: { applicationCycleId: cycle.id, ...inReviewPipelineFilter },
              reviews: { every: { submittedAt: { not: null } }, some: {} },
              decisions: { none: { stage: { in: ["Final", "Released"] } } },
            },
          })
        : 0;

      // Final-delibs qualifier differs by cycle type. Standard: post-interview.
      // InternToFull: no interview, so "all reviews submitted" is the gate.
      const finalDelibsCount = cycle
        ? await prisma.domainApplication.count({
            where: {
              selected: true,
              ...daDomainMatch,
              application: { applicationCycleId: cycle.id, ...inReviewPipelineFilter },
              ...(isInternToFull
                ? {
                    reviews: { every: { submittedAt: { not: null } }, some: {} },
                    decisions: { none: { stage: { in: ["Final", "Released"] } } },
                  }
                : {
                    interviews: { some: { status: "Completed" } },
                  }),
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
                ...daDomainMatch,
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
            include: { user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } } },
          })
        : [];

      // Rubric options — rubrics are not domain-specific, so all rubric versions are eligible.
      const rubricVersionOptions = await prisma.rubricVersion.findMany({
        include: { rubric: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      });
      const currentRubricVersionId = cycle?.domains[0]?.rubricVersionId ?? null;
      // Flat criteria list for the ReviewModal's score labels, resilient to
      // rubric edits: current domain rubric + general rubric + any versions
      // pinned on this domain's reviews (and their history), so scores keyed by
      // an older rubric version still resolve instead of leaking raw crit-<ts>.
      const domainReviewVersionIds = cycle
        ? (
            await prisma.applicationReview.findMany({
              where: {
                domainApplication: {
                  ...daDomainMatch,
                  application: { applicationCycleId: cycle.id },
                },
                rubricVersionId: { not: null },
              },
              select: { rubricVersionId: true },
              distinct: ["rubricVersionId"],
            })
          ).map((r) => r.rubricVersionId)
        : [];
      const generalCriteria = cycle?.generalRubricVersionId
        ? ((rubricVersionOptions.find((rv) => rv.id === cycle.generalRubricVersionId)
            ?.criteria as any[] | null) ?? undefined)
        : undefined;
      const rubricCriteria = await buildCriteriaList({
        domainRubricVersionId: currentRubricVersionId,
        generalCriteria,
        pinnedVersionIds: domainReviewVersionIds,
      });

      // Interviewers for this domain in this cycle (with availability blocks —
      // the component sums their durations to show total hours offered).
      const interviewersRaw = cycle
        ? await prisma.cycleInterviewer.findMany({
            where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
            include: {
              user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
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
                ...daDomainMatch,
                application: { applicationCycleId: cycle.id },
              },
            },
          })) > 0
        : false;

      // When the user has not signed the cycle's confidentiality agreement,
      // strip every sensitive data path: applicant identities (cycle.applications),
      // assigned applications, scheduled interviews, draft decisions, and delibs
      // sessions. The dashboard still loads so the domain lead can see static
      // setup (challenges, rubric, team, counts that depend only on staff side)
      // and gets a placeholder pointing at the sign page.
      if (confidentialityRequired) {
        const sanitizedCycle = { ...cycle, applications: [] };
        return {
          assignment,
          cycle: sanitizedCycle,
          availableCycles,
          apps: [] as any[],
          challengeVersionOptions,
          linkedChallengeVersions,
          isChallengeReady,
          interviews: [] as any[],
          reviewers,
          delibsSessions: [] as any[],
          draftDecisions: [] as any[],
          cycleReviewersForDomain,
          initialDelibsCount: 0,
          finalDelibsCount: 0,
          rubricVersionOptions,
          currentRubricVersionId,
          rubricCriteria,
          interviewers,
          hasApplicationReviews,
          confidentialityRequired,
        };
      }

      return { assignment, cycle, availableCycles, apps: appsWithStatus, challengeVersionOptions, linkedChallengeVersions, isChallengeReady, interviews, reviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, initialDelibsCount, finalDelibsCount, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews, confidentialityRequired: null as null | "no_agreement" | "unsigned" };
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
          OR: [
            { challengeVersion: { domainId } },
            { domainId },
          ],
          application: { applicationCycleId: cycleId },
        },
      },
    });
    if (hasAssignedReviews > 0) {
      return redirect("/hiring/domain-lead");
    }

    await prisma.domainApplicationCycle.update({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      data: { rubricVersionId },
    });
    return redirect("/hiring/domain-lead");
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
      return redirect("/hiring/domain-lead");
    }

    // Confirm the chosen version belongs to the named domain — guard against
    // form tampering linking a different domain's challenge.
    const cv = await prisma.challengeVersion.findUnique({ where: { id: newVersionId } });
    if (!cv || cv.domainId !== domainId) {
      return redirect("/hiring/domain-lead");
    }

    // Prevent linking two versions of the same underlying challenge in one cycle.
    const sameChallenge = await prisma.challengeVersionApplicationCycle.findFirst({
      where: {
        applicationCycleId: cycleId,
        challengeVersion: { challengeId: cv.challengeId, domainId },
      },
    });
    if (sameChallenge) {
      return redirect("/hiring/domain-lead");
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
    return redirect("/hiring/domain-lead");
  }

  if (intent === "remove-challenge") {
    const cycleId = formData.get("cycleId") as string;
    const versionId = formData.get("challengeVersionId") as string;

    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect("/hiring/domain-lead");
    }

    // Refuse to remove if any DomainApplication in this cycle picked this CV.
    const inUse = await prisma.domainApplication.count({
      where: {
        challengeVersionId: versionId,
        application: { applicationCycleId: cycleId },
      },
    });
    if (inUse > 0) {
      return redirect("/hiring/domain-lead");
    }

    await prisma.challengeVersionApplicationCycle.deleteMany({
      where: { challengeVersionId: versionId, applicationCycleId: cycleId },
    });
    return redirect("/hiring/domain-lead");
  }

  if (intent === "mark-ready" || intent === "unmark-ready") {
    const cycleId = formData.get("cycleId") as string;
    const domainId = formData.get("domainId") as string;
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect("/hiring/domain-lead");
    }
    const isReady = intent === "mark-ready";
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      update: { isReady },
      create: { domainId, applicationCycleId: cycleId, isReady },
    });
    return redirect("/hiring/domain-lead");
  }

  return redirect("/hiring/domain-lead");
}

function Section({ title, subtitle, badge, defaultOpen = true, children }: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="py-4 first:pt-0">
      <button
        onClick={() => setOpen(!open)}
        className="group w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <span className="text-base font-semibold text-foreground group-hover:text-foreground transition">{title}</span>
          {subtitle && (
            <p className="text-xs text-muted-foreground/80 mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {badge}
          <ChevronDown className={`w-4 h-4 text-muted-foreground/70 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = "confirm-dialog-title";
  return (
    <Modal open={open} onClose={onCancel} labelledBy={titleId}>
      <div className="space-y-4">
        <h2 id={titleId} className="text-base font-semibold text-foreground">{title}</h2>
        <div className="text-sm text-muted-foreground">{body}</div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-card hover:bg-muted/50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-sm font-medium rounded-md text-white transition ${destructive ? "bg-red-600 hover:bg-red-700" : "bg-accent-coral hover:bg-accent-coral/90"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
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

// Find the most-recent Draft decision that hasn't been superseded by a Final
// or Released sibling of the same type. Mirrors the per-row finalize lookup in
// `ApplicationsTable` so the Interviews section uses the same definition of
// "needs finalization".
function findFinalizableDraft(decisions: any[]) {
  return decisions.find((d: any) => {
    if (d.stage !== "Draft") return false;
    return !decisions.some(
      (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
    );
  });
}

export default function DomainLeadDashboard() {
  const data = useLoaderData<typeof loader>() as any;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const domainData = data?.domainData ?? [];

  if (domainData.length === 0) {
    return (
      <div className="text-center py-16">
        <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Domain Lead Dashboard</h1>
        <p className="text-muted-foreground">You are not assigned as a domain lead for any domain.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="font-heading text-2xl font-bold text-foreground">Domain Lead Dashboard</h1>

      {domainData.map(({ assignment, cycle, availableCycles, apps, challengeVersionOptions, linkedChallengeVersions, isChallengeReady, interviews, reviewers: cycleReviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, initialDelibsCount, finalDelibsCount, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews, confidentialityRequired }: any, idx: number) => {
        const isInternToFull = cycle?.cycleType === "InternToFull";
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
                  <h2 className="font-heading text-2xl font-bold text-foreground">{assignment.domain.name}</h2>
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
                      <h2 className="font-heading text-2xl font-bold text-foreground">{assignment.domain.name}</h2>
                      <span className="text-muted-foreground/70 hidden sm:inline">·</span>
                      <span className="text-lg text-muted-foreground">{cycle.name}</span>
                      {currentStatus && (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-current/30 ${STATUS_COLORS[currentStatus]}`}>
                          {STATUS_LABELS[currentStatus]}
                        </span>
                      )}
                      <CycleSelector cycles={availableCycles ?? []} activeId={cycle.id} />
                    </div>
                    {currentStatus !== "Draft" && !confidentialityRequired && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <StatPill label="submitted" value={apps.length} />
                        {fullyReviewed > 0 && <StatPill label="reviewed" value={fullyReviewed} color="text-green-700" />}
                        {withDecisions > 0 && <StatPill label="decided" value={withDecisions} color="text-blue-700" />}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{STATUS_MESSAGES[currentStatus]}</p>
                </div>

                <div className="px-4 sm:px-6 py-2 divide-y divide-border">
                  {/* Setup — Draft only. Hidden on InternToFull (no challenges). */}
                  {currentStatus === "Draft" && !isInternToFull && (
                    <Section
                      title="Challenges (setup)"
                      subtitle="Pick which challenge versions applicants answer."
                      badge={
                        isChallengeReady
                          ? <span className="text-xs text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full font-medium">Ready</span>
                          : <span className="text-xs text-yellow-700 bg-yellow-100 border border-yellow-200 px-2 py-0.5 rounded-full font-medium">Action needed</span>
                      }
                      defaultOpen={!isChallengeReady}
                    >
                      <div className="space-y-4">
                        <DraftSection
                          cycle={cycle}
                          domainId={assignment.domainId}
                          challengeVersionOptions={challengeVersionOptions}
                          linkedChallengeVersions={linkedChallengeVersions ?? []}
                          isChallengeReady={isChallengeReady}
                        />
                        <div className="flex items-center gap-3 pt-2 border-t border-border">
                          <Link to="/hiring/library?tab=challenges" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            {hasLinkedChallenge ? "Manage Challenges →" : "Create Challenge →"}
                          </Link>
                        </div>
                      </div>
                    </Section>
                  )}

                  {/* Setup — just the domain challenges (read-only after Draft).
                      Hidden on InternToFull (no challenges). */}
                  {currentStatus !== "Draft" && (currentStatus === "Open" || currentStatus === "UnderReview") && !isInternToFull && (
                    <div className="pt-4">
                    <Section
                      title="Challenges (locked)"
                      subtitle={
                        hasApplicationReviews
                          ? "Reviewers assigned — challenges can no longer change."
                          : currentStatus === "Open"
                            ? "Cycle is open — challenges are frozen."
                            : "Cycle under review — challenges are frozen."
                      }
                      badge={
                        hasLinkedChallenge
                          ? <span className="text-xs text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full font-medium">Configured</span>
                          : <span className="text-xs text-yellow-700 bg-yellow-100 border border-yellow-200 px-2 py-0.5 rounded-full font-medium">Needs attention</span>
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
                                      to={`/hiring/challenges/${cv.challengeId}?versionId=${cv.id}`}
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
                              <Link to="/hiring/library?tab=challenges" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                                Create Challenge →
                              </Link>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                          <Link to="/hiring/library?tab=challenges" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            All Challenges →
                          </Link>
                        </div>
                      </div>
                    </Section>
                    </div>
                  )}

                  {/* Rubric — scoring criteria.
                      InternToFull cycles use only the cycle-level general
                      rubric (set by the hiring lead), so the per-domain picker
                      is hidden and replaced with a read-only summary. */}
                  {isInternToFull ? (
                    <Section
                      title="Rubric"
                      subtitle="Cycle-wide rubric set by the hiring lead — applies to every application."
                      badge={
                        cycle.generalRubricVersionId
                          ? <span className="text-xs text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full font-medium">Set</span>
                          : <span className="text-xs text-yellow-700 bg-yellow-100 border border-yellow-200 px-2 py-0.5 rounded-full font-medium">Not set</span>
                      }
                      defaultOpen={!cycle.generalRubricVersionId}
                    >
                      {!cycle.generalRubricVersionId && (
                        <div className="flex items-center gap-2 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
                          <Clock className="w-4 h-4 flex-shrink-0" />
                          <span>Waiting on hiring lead to set the cycle rubric — reviewer assignment is blocked until it's set.</span>
                        </div>
                      )}
                      <div className="mt-2">
                        <Link to="/hiring/library?tab=rubrics" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                          All Rubrics →
                        </Link>
                      </div>
                    </Section>
                  ) : (
                    <Section
                      title="Rubric"
                      subtitle="Scoring criteria reviewers use for this domain."
                      badge={
                        currentRubricVersionId
                          ? <span className="text-xs text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full font-medium">Set</span>
                          : <span className="text-xs text-yellow-700 bg-yellow-100 border border-yellow-200 px-2 py-0.5 rounded-full font-medium">Not set</span>
                      }
                      defaultOpen={!currentRubricVersionId}
                    >
                      <div>
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
                          <Link to="/hiring/library?tab=rubrics" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            All Rubrics →
                          </Link>
                        </div>
                      </div>
                    </Section>
                  )}

                  {/* Team — Reviewers (+ Interviewers for Standard cycles only). */}
                  <Section
                    title="Team"
                    subtitle={
                      isInternToFull
                        ? "Reviewers assigned to this domain."
                        : "Reviewers and interviewers assigned to this domain."
                    }
                    badge={
                      <span className="text-xs text-muted-foreground">
                        {cycleReviewers.length} reviewer{cycleReviewers.length !== 1 ? "s" : ""}
                        {!isInternToFull && (
                          <>, {(interviewers ?? []).length} interviewer{(interviewers ?? []).length !== 1 ? "s" : ""}</>
                        )}
                      </span>
                    }
                    defaultOpen={currentStatus === "Draft" || currentStatus === "Open"}
                  >
                    <div className={`grid grid-cols-1 ${isInternToFull ? "" : "md:grid-cols-2"} gap-4`}>
                      <ReviewerSection cycleId={cycle.id} domainId={assignment.domainId} initialReviewers={cycleReviewers} />
                      {!isInternToFull && (
                        <InterviewerSection cycleId={cycle.id} domainId={assignment.domainId} initialInterviewers={interviewers ?? []} />
                      )}
                    </div>
                  </Section>

                  {/* Reviews — applicants still under review plus those rejected
                      at the review stage. Anyone invited to interview moves to
                      the Interviews section below, so the two never duplicate. */}
                  {currentStatus !== "Draft" && (() => {
                    const reviewApps = apps.filter((a: any) => {
                      const status = a.domainApplications?.[0]?.inferredStatus;
                      return (
                        status !== "InvitedToInterview" &&
                        status !== "InterviewScheduled" &&
                        status !== "PostInterviewPending"
                      );
                    });
                    return (
                    <Section
                      title="Reviews"
                      badge={
                        confidentialityRequired ? (
                          <span className="text-xs text-muted-foreground">hidden</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{apps.length} submitted</span>
                            <span>·</span>
                            <span>{fullyReviewed} reviewed</span>
                            {needsReviewers > 0 && <><span>·</span><span className="text-yellow-700">{needsReviewers} need reviewers</span></>}
                          </div>
                        )
                      }
                      defaultOpen={true}
                    >
                      {confidentialityRequired ? (
                        <ConfidentialityGate
                          cycleId={cycle.id}
                          reason={confidentialityRequired}
                          next="/hiring/domain-lead"
                        />
                      ) : reviewApps.length > 0 ? (
                        <ApplicationsTable
                          apps={reviewApps}
                          draftDecisions={draftDecisions ?? []}
                          cycleReviewersForDomain={cycleReviewersForDomain}
                          cycleId={cycle.id}
                          domainId={assignment.domainId}
                          currentStatus={currentStatus}
                          canAssignReviewers={isInternToFull ? !!cycle.generalRubricVersionId : !!currentRubricVersionId && !!cycle.generalRubricVersionId}
                          rubricCriteria={rubricCriteria ?? []}
                        />
                      ) : (
                        <div className="text-center text-muted-foreground text-sm py-6">
                          No applicants in review. Anyone invited to interview appears under Interviews.
                        </div>
                      )}
                    </Section>
                    );
                  })()}

                  {/* Deliberations — UnderReview only */}
                  {currentStatus === "UnderReview" && (
                    <Section
                      title="Deliberations"
                      badge={
                        confidentialityRequired ? (
                          <span className="text-xs text-muted-foreground">hidden</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {!isInternToFull && (
                              <>
                                <span>{initialDelibsCount ?? 0} ready for initial</span>
                                <span>·</span>
                              </>
                            )}
                            <span>{finalDelibsCount ?? 0} ready for final</span>
                          </div>
                        )
                      }
                      defaultOpen={(initialDelibsCount ?? 0) > 0 || (finalDelibsCount ?? 0) > 0}
                    >
                      {confidentialityRequired ? (
                        <ConfidentialityGate
                          cycleId={cycle.id}
                          reason={confidentialityRequired}
                          next="/hiring/domain-lead"
                        />
                      ) : (
                        <DelibsSection cycleId={cycle.id} domainId={assignment.domainId} sessions={delibsSessions ?? []} initialCount={initialDelibsCount ?? 0} finalCount={finalDelibsCount ?? 0} />
                      )}
                    </Section>
                  )}

                  {/* Interviews — Standard cycles only (InternToFull has no
                      interview round). */}
                  {isInternToFull ? null : confidentialityRequired && currentStatus === "UnderReview" ? (
                    <Section
                      title="Interviews"
                      badge={<span className="text-xs text-muted-foreground">hidden</span>}
                      defaultOpen={true}
                    >
                      <ConfidentialityGate
                        cycleId={cycle.id}
                        reason={confidentialityRequired}
                        next="/hiring/domain-lead"
                      />
                    </Section>
                  ) : confidentialityRequired ? null : (() => {
                    const invited = apps.filter((a: any) => {
                      const status = a.domainApplications?.[0]?.inferredStatus;
                      return status === "InvitedToInterview" || status === "InterviewScheduled" || status === "PostInterviewPending";
                    });
                    const awaitingBooking = invited.filter((a: any) => a.domainApplications?.[0]?.inferredStatus === "InvitedToInterview");
                    const hasAnyInterviewActivity = invited.length > 0 || interviews.length > 0;

                    const interviewersWithAvailability = (interviewers ?? []).filter((i: any) => i.availabilityHours > 0);
                    const noAvailability = invited.length > 0 && interviewersWithAvailability.length === 0;

                    // Post-interview applicants whose Final-delibs Draft hasn't
                    // been promoted to Final yet. Their `inferredStatus` is
                    // still `PostInterviewPending` (which keys off the latest
                    // *Released* decision), so they live in this section rather
                    // than Reviews — but the finalize UI on `ApplicationsTable`
                    // never reached them. Surface the action here instead.
                    const finalizableByDaId = new Map<string, any>();
                    for (const app of invited) {
                      const da = app.domainApplications?.[0];
                      if (!da) continue;
                      const draft = findFinalizableDraft(da.decisions ?? []);
                      if (draft) finalizableByDaId.set(da.id, draft);
                    }
                    const finalizableCount = finalizableByDaId.size;
                    const canFinalize = currentStatus === "UnderReview";
                    const finalizeOne = async (daId: string | undefined) => {
                      if (!daId) return;
                      const draft = finalizableByDaId.get(daId);
                      if (!draft) return;
                      await fetch(`/api/hiring/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
                      revalidator.revalidate();
                    };
                    const finalizeAll = async () => {
                      for (const draft of finalizableByDaId.values()) {
                        await fetch(`/api/hiring/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
                      }
                      revalidator.revalidate();
                    };

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

                          {/* Post-interview finalize banner — appears once Final
                              delibs have been closed and produced Draft decisions
                              on these applicants. */}
                          {canFinalize && finalizableCount > 0 && (
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-accent-coral/5 border border-accent-coral/30 rounded-lg px-4 py-3">
                              <div className="text-sm flex-1">
                                <span className="font-medium text-foreground">
                                  {finalizableCount} post-interview decision{finalizableCount === 1 ? "" : "s"} ready to finalize
                                </span>
                                <span className="text-muted-foreground">
                                  {" "}— drafts from final delibs. Finalizing locks them in for the hiring lead to release.
                                </span>
                              </div>
                              <button
                                onClick={finalizeAll}
                                className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-coral hover:bg-accent-coral/90 text-white transition self-start sm:self-auto"
                              >
                                Finalize All ({finalizableCount})
                              </button>
                            </div>
                          )}

                          {/* One Interviews table: booked interviews AND
                              invited-but-not-yet-booked applicants share the same
                              table, with booking surfaced in the Status column.
                              Styling mirrors the Reviews table (px-6 padding,
                              bg-muted/50 head, divide-y rows). */}
                          {(() => {
                            const fmtAssignment = (a: any) => {
                              const m = a.cycleInterviewer.user;
                              return m.firstName && m.lastName
                                ? `${m.firstName} ${m.lastName}`
                                : m.daliEmail ?? '?';
                            };
                            // Booked rows from interview records.
                            const bookedRows = interviews.map((interview: any) => {
                              const start = new Date(interview.startTime);
                              const end = new Date(interview.endTime);
                              return {
                                key: interview.id,
                                daId: interview.domainApplication?.id as string | undefined,
                                name: `${interview.domainApplication.application.user.firstName} ${interview.domainApplication.application.user.lastName}`,
                                booked: true,
                                status: interview.status as string,
                                time: `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
                                location:
                                  interview.location === 'PodAppa' ? 'Pod Appa'
                                  : interview.location === 'PodMomo' ? 'Pod Momo'
                                  : 'Online',
                                zoomJoinUrl: interview.location === 'Online' ? interview.zoomJoinUrl : null,
                                inDomain: interview.assignments
                                  .filter((a: any) => a.role === 'InDomain' && a.status === 'Active')
                                  .map(fmtAssignment)
                                  .join(', ') || '—',
                                crossDomain: interview.assignments
                                  .filter((a: any) => a.role === 'CrossDomain' && a.status === 'Active')
                                  .map((a: any) => `${fmtAssignment(a)} (${a.cycleInterviewer.domain.name})`)
                                  .join(', ') || '—',
                              };
                            });
                            // Invited-but-not-booked applicants become rows too.
                            const pendingRows = awaitingBooking.map((app: any) => ({
                              key: `pending-${app.id}`,
                              daId: app.domainApplications?.[0]?.id as string | undefined,
                              name: `${app.user.firstName} ${app.user.lastName}`,
                              booked: false,
                              status: 'Invited — not booked',
                              time: '—',
                              location: '—',
                              zoomJoinUrl: null,
                              inDomain: '—',
                              crossDomain: '—',
                            }));
                            // Awaiting booking first (needs action), then booked.
                            const rows = [...pendingRows, ...bookedRows];
                            // Decisions/pills for each row, looked up via the
                            // domain application on `invited`. Mirrors the
                            // Reviews table's Decisions column so the two
                            // panels read consistently.
                            const appByDaId = new Map<string, any>();
                            for (const app of invited) {
                              const da = app.domainApplications?.[0];
                              if (da?.id) appByDaId.set(da.id, app);
                            }
                            const renderDecisionCell = (daId: string | undefined) => {
                              if (!daId) return <span className="text-xs text-muted-foreground">—</span>;
                              const app = appByDaId.get(daId);
                              const da = app?.domainApplications?.[0];
                              if (!da) return <span className="text-xs text-muted-foreground">—</span>;
                              const decisions = da.decisions ?? [];
                              const pills = summarizeDecisionPills({ decisions });
                              const currentId = currentDecisionId(decisions);
                              if (pills.length > 0) {
                                return (
                                  <div className="flex flex-wrap gap-1">
                                    {pills.map((pill, i) => (
                                      <DecisionPillBadge key={i} pill={pill} isCurrent={!!pill.id && pill.id === currentId} />
                                    ))}
                                  </div>
                                );
                              }
                              const prePill = synthesizePrePipelinePill({
                                application: { statusUpdates: app.statusUpdates ?? [] },
                                interviews: da.interviews ?? [],
                                decisions,
                              });
                              return prePill
                                ? <PrePipelinePillBadge pill={prePill} />
                                : <span className="text-xs text-muted-foreground">—</span>;
                            };
                            const statusPill = (row: any) =>
                              !row.booked
                                ? 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                                : row.status === 'Completed'
                                  ? 'bg-green-100 text-green-700 border border-green-200'
                                  : 'bg-blue-100 text-blue-700 border border-blue-200';
                            // Clicking a row opens that applicant's review/detail
                            // page — same target as the Reviews table.
                            const openReview = (row: any) => {
                              if (!row.daId) return;
                              const url = `/hiring/domain-lead/application/${row.daId}`;
                              const label = row.name || 'Applicant';
                              if (!requestOpenTabIfEmbedded(url, label)) navigate(url);
                            };
                            if (rows.length === 0) return null;
                            return (
                              <div>
                                <div className="hidden sm:block overflow-x-auto border border-border rounded-lg">
                                  <table className="w-full text-sm min-w-[900px]">
                                    <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                      <tr>
                                        <th className="px-6 py-3 text-left">Applicant</th>
                                        <th className="px-6 py-3 text-left">Time</th>
                                        <th className="px-6 py-3 text-left">Location</th>
                                        <th className="px-6 py-3 text-left">Status</th>
                                        <th className="px-6 py-3 text-left">Decisions</th>
                                        <th className="px-6 py-3 text-left">In-Domain</th>
                                        <th className="px-6 py-3 text-left">Cross-Domain</th>
                                        <th className="px-6 py-3 text-right">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {rows.map((row) => (
                                        <tr
                                          key={row.key}
                                          onClick={() => openReview(row)}
                                          className={`hover:bg-muted/50 ${row.daId ? "cursor-pointer" : ""}`}
                                        >
                                          <td className="px-6 py-4 font-medium text-foreground">{row.name}</td>
                                          <td className="px-6 py-4 text-muted-foreground">{row.time}</td>
                                          <td className="px-6 py-4 text-muted-foreground text-xs">
                                            {row.location}
                                            {row.zoomJoinUrl && (
                                              <a href={row.zoomJoinUrl} target="_blank" rel="noopener noreferrer"
                                                 onClick={(e) => e.stopPropagation()}
                                                 className="block text-xs text-blue-600 hover:underline mt-0.5">Zoom</a>
                                            )}
                                          </td>
                                          <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${statusPill(row)}`}>
                                              {row.status}
                                            </span>
                                          </td>
                                          <td className="px-6 py-4">{renderDecisionCell(row.daId)}</td>
                                          <td className="px-6 py-4 text-muted-foreground text-xs">{row.inDomain}</td>
                                          <td className="px-6 py-4 text-muted-foreground text-xs">{row.crossDomain}</td>
                                          <td className="px-6 py-4 text-right">
                                            {canFinalize && row.daId && finalizableByDaId.has(row.daId) ? (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); finalizeOne(row.daId); }}
                                                className="px-2 py-1 text-xs font-medium rounded bg-accent-coral hover:bg-accent-coral/90 text-white transition"
                                              >
                                                Finalize
                                              </button>
                                            ) : (
                                              <span className="text-xs text-muted-foreground/60">—</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                <ul className="sm:hidden space-y-2">
                                  {rows.map((row) => (
                                    <li
                                      key={row.key}
                                      onClick={() => openReview(row)}
                                      className={`border border-border rounded-lg p-3 space-y-2 ${row.daId ? "cursor-pointer hover:bg-muted/50" : ""}`}
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="font-medium text-foreground min-w-0 truncate">{row.name}</div>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0 ${statusPill(row)}`}>
                                          {row.status}
                                        </span>
                                      </div>
                                      {row.booked && (
                                        <>
                                          <div className="text-xs text-muted-foreground">{row.time}</div>
                                          <div className="text-xs text-muted-foreground">
                                            {row.location}
                                            {row.zoomJoinUrl && (
                                              <a href={row.zoomJoinUrl} target="_blank" rel="noopener noreferrer"
                                                 onClick={(e) => e.stopPropagation()}
                                                 className="ml-2 text-blue-600 hover:underline">Zoom</a>
                                            )}
                                          </div>
                                          <div className="text-xs text-muted-foreground"><span className="font-medium">In-Domain:</span> {row.inDomain}</div>
                                          <div className="text-xs text-muted-foreground"><span className="font-medium">Cross-Domain:</span> {row.crossDomain}</div>
                                        </>
                                      )}
                                      <div>
                                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Decisions</div>
                                        {renderDecisionCell(row.daId)}
                                      </div>
                                      {canFinalize && row.daId && finalizableByDaId.has(row.daId) && (
                                        <div className="flex flex-wrap items-center gap-2">
                                          <button
                                            onClick={(e) => { e.stopPropagation(); finalizeOne(row.daId); }}
                                            className="px-2 py-1 text-xs font-medium rounded bg-accent-coral hover:bg-accent-coral/90 text-white transition"
                                          >
                                            Finalize
                                          </button>
                                        </div>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })()}
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

function DraftSection({ cycle, domainId, challengeVersionOptions, linkedChallengeVersions, isChallengeReady }: {
  cycle: any;
  domainId: string;
  challengeVersionOptions: any[];
  linkedChallengeVersions: any[];
  isChallengeReady: boolean;
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
                  to={`/hiring/challenges/${cv.challengeId}?versionId=${cv.id}`}
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

        <Form method="post" preventScrollReset>
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
          <Form method="post" preventScrollReset>
            <input type="hidden" name="intent" value="mark-ready" />
            <input type="hidden" name="cycleId" value={cycle.id} />
            <input type="hidden" name="domainId" value={domainId} />
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-accent-coral text-white text-sm font-semibold rounded-lg hover:bg-accent-coral/90"
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
  const [previewCvId, setPreviewCvId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<any | null>(null);
  const submit = useSubmit();
  const previewCv = previewCvId
    ? linkedChallengeVersions.find((cv: any) => cv.id === previewCvId)
    : null;

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
                    <div className="text-sm font-medium">
                      <Link
                        to={`/hiring/challenges/${cv.challengeId}?versionId=${cv.id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {formatVersionLabel({
                          name: cv.challenge?.name ?? "Untitled",
                          versionNumber: cv.versionNumber,
                          createdAt: cv.createdAt,
                          createdBy: cv.createdBy,
                        })}
                      </Link>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {questions.length} question{questions.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewCvId(cv.id)}
                      aria-label={`Preview ${cv.challenge?.name ?? "challenge"}`}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemove(cv)}
                      aria-label={`Remove ${cv.challenge?.name ?? "challenge"}`}
                      className="text-muted-foreground hover:text-red-600 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
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
        <Form method="post" preventScrollReset className="flex items-end gap-3">
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
            className="px-3 py-2 text-sm font-medium text-white bg-accent-teal rounded-md hover:bg-accent-teal/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </Form>
      ) : linkedChallengeVersions.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">
          No challenge versions exist for this domain yet.
        </p>
      ) : null}

      {previewCv && (
        <ChallengePreviewModal
          challengeVersionId={previewCv.id}
          challengeName={previewCv.challenge?.name ?? "Challenge"}
          versionLabel={formatVersionLabel({
            name: previewCv.challenge?.name ?? "Challenge",
            versionNumber: previewCv.versionNumber,
            createdAt: previewCv.createdAt,
            createdBy: previewCv.createdBy,
          })}
          description={previewCv.description}
          questions={(previewCv.questions as any[]) ?? []}
          onClose={() => setPreviewCvId(null)}
        />
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title="Remove this challenge from the cycle?"
        body={
          <>
            <p>Applicants will no longer see <strong>{pendingRemove?.challenge?.name ?? "this challenge"}</strong> when they apply to this domain.</p>
            <p className="mt-2">If anyone has already started an application referencing it, the remove will be rejected by the server.</p>
          </>
        }
        confirmLabel="Remove"
        destructive
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          const fd = new FormData();
          fd.set("intent", "remove-challenge");
          fd.set("cycleId", cycleId);
          fd.set("challengeVersionId", pendingRemove.id);
          submit(fd, { method: "post", preventScrollReset: true });
          setPendingRemove(null);
        }}
      />
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
  const [pendingRemove, setPendingRemove] = useState<any | null>(null);

  // Resync from props after the loader revalidates (e.g. bulk auto-assign in
  // the Applications toolbar). Without this, optimistic local state lingers
  // and the UI shows the pre-action snapshot until a hard reload.
  useEffect(() => { setReviewers(initialReviewers); }, [initialReviewers]);

  useEffect(() => {
    // Reviewer assignment targets current-term members only — alumni shouldn't
    // surface as options for an active cycle's reviewer pool.
    fetch('/api/members?scope=current', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => {});
  }, []);

  async function addReviewer() {
    if (!selectedMemberId) return;
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedMemberId, domainId, isLead: false }),
    });
    if (res.ok) {
      const reviewer = await res.json();
      setReviewers(prev => [...prev, reviewer]);
      setSelectedMemberId('');
    }
  }

  async function removeReviewer(reviewerId: string) {
    try {
      const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers/${reviewerId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (res.ok) {
        setReviewers(prev => prev.filter(r => r.id !== reviewerId));
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to remove reviewer:", res.status, err);
        alert(`Failed to remove reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to remove reviewer:", e);
      alert(`Failed to remove reviewer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const pendingName = pendingRemove
    ? (pendingRemove.user?.firstName && pendingRemove.user?.lastName
        ? `${pendingRemove.user.firstName} ${pendingRemove.user.lastName}`
        : pendingRemove.user?.daliEmail ?? "this reviewer")
    : "";

  // Filter out members already assigned as reviewers for this domain
  const existingMemberIds = new Set(reviewers.map((r: any) => r.userId));
  const availableMembers = members.filter(m => !existingMemberIds.has(m.id));

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reviewers ({reviewers.length})</h4>
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
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-accent-teal hover:bg-accent-teal/90 text-white transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {reviewers.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {reviewers.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-foreground">
                  {r.user?.firstName && r.user?.lastName ? `${r.user.firstName} ${r.user.lastName}` : r.user?.daliEmail ?? r.userId}
                </span>
                <button
                  onClick={() => setPendingRemove(r)}
                  aria-label="Remove reviewer"
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70 text-center py-3">No reviewers assigned yet.</p>
        )}
        <ConfirmDialog
          open={!!pendingRemove}
          title={`Remove ${pendingName} as a reviewer?`}
          body={
            <p>
              They will no longer be assignable to applicants in this domain. Any reviews they've already submitted for this cycle will be deleted.
            </p>
          }
          confirmLabel="Remove reviewer"
          destructive
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            if (pendingRemove) removeReviewer(pendingRemove.id);
            setPendingRemove(null);
          }}
        />
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
    <>
      {locked ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span>{selectedLabel}</span>
          <span className="text-xs text-muted-foreground/70 ml-2">(locked — reviewers have been assigned)</span>
        </div>
      ) : (
        <Form method="post" preventScrollReset key={`rubric-${selectedId}`} className="flex flex-col sm:flex-row sm:items-end gap-3">
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
              className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-teal hover:bg-accent-teal/90 text-white transition"
            >
              Save
            </button>
        </Form>
      )}
    </>
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
  const [pendingRemove, setPendingRemove] = useState<any | null>(null);

  // Resync from props after the loader revalidates.
  useEffect(() => { setInterviewers(initialInterviewers); }, [initialInterviewers]);

  useEffect(() => {
    // Interviewer assignment targets current-term members only — alumni
    // shouldn't surface as options for an active cycle's interviewer pool.
    fetch("/api/members?scope=current", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => {});
  }, []);

  async function addInterviewer() {
    if (!selectedMemberId) return;
    const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedMemberId, domainId }),
    });
    if (res.ok) {
      const interviewer = await res.json();
      const member = members.find((m: any) => m.id === selectedMemberId);
      setInterviewers(prev => [...prev, { ...interviewer, user: member, availabilityHours: 0 }]);
      setSelectedMemberId("");
    }
  }

  async function removeInterviewer(interviewerId: string) {
    try {
      const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewerId }),
      });
      if (res.ok) {
        setInterviewers(prev => prev.filter(i => i.id !== interviewerId));
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to remove interviewer:", res.status, err);
        alert(`Failed to remove interviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to remove interviewer:", e);
      alert(`Failed to remove interviewer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const existingMemberIds = new Set(interviewers.map((i: any) => i.userId));
  const availableMembers = members.filter(m => !existingMemberIds.has(m.id));
  const pendingName = pendingRemove
    ? (pendingRemove.user?.firstName && pendingRemove.user?.lastName
        ? `${pendingRemove.user.firstName} ${pendingRemove.user.lastName}`
        : pendingRemove.user?.daliEmail ?? "this interviewer")
    : "";

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Interviewers ({interviewers.length})</h4>
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
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-accent-teal hover:bg-accent-teal/90 text-white transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {interviewers.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {interviewers.map((i: any) => {
              const m = i.user;
              const name = m?.firstName && m?.lastName
                ? `${m.firstName} ${m.lastName}`
                : m?.daliEmail ?? i.userId;
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
                      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted/50 border border-current/40 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        No availability
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setPendingRemove(i)}
                    aria-label="Remove interviewer"
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70 text-center py-3">No interviewers assigned yet.</p>
        )}
        <ConfirmDialog
          open={!!pendingRemove}
          title={`Remove ${pendingName} as an interviewer?`}
          body={
            <p>
              They will no longer be assignable to interviews for this domain. Their availability blocks for this cycle will also be removed.
            </p>
          }
          confirmLabel="Remove interviewer"
          destructive
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            if (pendingRemove) removeInterviewer(pendingRemove.id);
            setPendingRemove(null);
          }}
        />
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
    const res = await fetch(`/api/hiring/cycles/${cycleId}/delibs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId, type }),
    });
    if (res.ok) {
      const session = await res.json();
      window.location.href = `/hiring/domain-lead/delibs/${session.id}`;
    }
    setLoading(null);
  }

  function renderButton(type: "Initial" | "Final", session: any) {
    const count = type === "Initial" ? initialCount : finalCount;
    const countBadge = ` (${count} applicant${count !== 1 ? "s" : ""})`;

    if (session?.status === "Active") {
      return (
        <a
          href={`/hiring/domain-lead/delibs/${session.id}`}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-coral hover:bg-accent-coral/90 text-white transition"
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
        className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/70 text-foreground border border-border transition disabled:opacity-50"
      >
        {loading === type ? "Starting..." : `Start ${type} Delibs${countBadge}`}
      </button>
    );
  }

  return (
    <div className="space-y-3">
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
  );
}

// Stage treatment composes on top of the `border border-current/40` the badge
// always applies. Draft reads as "tentative" (faded + dashed, same hue);
// Final/Released keep the solid same-hue border.
const STAGE_TREATMENT: Record<DecisionPill["stage"], string> = {
  Draft: "opacity-60 border-dashed",
  Final: "",
  Released: "",
};

const DECISION_TOOLTIPS: Record<DecisionPill["stage"], (typeLabel: string) => string> = {
  Draft: (t) => `Draft ${t} — not yet finalized. Click Finalize to lock in.`,
  Final: (t) => `Final ${t} — decision locked. Will be released to the applicant by the hiring lead.`,
  Released: (t) => `Released ${t} — applicant has been notified.`,
};

const DECISION_ICONS: Record<DecisionType, React.ComponentType<{ className?: string }>> = {
  Rejected: X,
  InvitedToInterview: Send,
  Accepted: Check,
  Waitlisted: Clock,
};

function DecisionPillBadge({ pill, isCurrent = false }: { pill: DecisionPill; isCurrent?: boolean }) {
  const baseLabel = DECISION_LABELS[pill.type] ?? pill.type;
  const rankSuffix =
    pill.type === "Waitlisted" && pill.waitlistRank != null
      ? ` #${pill.waitlistRank}`
      : "";
  const stageSuffix = ` (${pill.stage.toLowerCase()})`;
  const Icon = DECISION_ICONS[pill.type];
  const tooltip = DECISION_TOOLTIPS[pill.stage](`${baseLabel}${rankSuffix}`);
  // "Current" emphasis ring uses the pill's OWN hue (ring-current = its text
  // color) so it reads as the same color as the border, not a competing gray
  // ring sitting just outside a red/green/etc. border.
  const accent = isCurrent ? "ring-2 ring-offset-1 ring-current/60" : "";
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border border-current/40 ${DECISION_COLORS[pill.type] ?? "bg-muted text-muted-foreground"} ${STAGE_TREATMENT[pill.stage]} ${accent}`}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {baseLabel}{rankSuffix}{stageSuffix}
    </span>
  );
}

const PRE_PIPELINE_LABELS: Record<PrePipelinePill, string> = {
  Reviewing: "Reviewing",
  InterviewScheduled: "Interview scheduled",
  PostInterview: "Post-interview",
};

const PRE_PIPELINE_TOOLTIPS: Record<PrePipelinePill, string> = {
  Reviewing: "Reviewers are evaluating this application. No decision has been made yet.",
  InterviewScheduled: "Applicant has booked an interview. Decision is pending until after the interview.",
  PostInterview: "Interview is complete. Waiting on final delibs to decide.",
};

const PRE_PIPELINE_ICONS: Record<PrePipelinePill, React.ComponentType<{ className?: string }>> = {
  Reviewing: Eye,
  InterviewScheduled: Clock,
  PostInterview: CircleDashed,
};

function PrePipelinePillBadge({ pill }: { pill: PrePipelinePill }) {
  const Icon = PRE_PIPELINE_ICONS[pill];
  return (
    <span
      title={PRE_PIPELINE_TOOLTIPS[pill]}
      aria-label={PRE_PIPELINE_TOOLTIPS[pill]}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-current/40"
    >
      <Icon className="w-3 h-3" />
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
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  // Which draft is currently being finalized — disables its Finalize button so a
  // double-click can't POST twice (the append-only Decision model would otherwise
  // create duplicate Final rows before the revalidate lands).
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const handleFinalize = async (draftId: string) => {
    if (finalizingId) return;
    setFinalizingId(draftId);
    try {
      const res = await fetch(`/api/hiring/decisions/${draftId}/finalize`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => null);
        alert(body?.error ?? "Failed to finalize. Please try again.");
      }
    } finally {
      setFinalizingId(null);
      revalidator.revalidate();
    }
  };
  const filter: "all" | "finalize" = searchParams.get("app_filter") === "finalize" ? "finalize" : "all";
  const query = searchParams.get("q") ?? "";
  // Default sort is "none" — preserves the loader's order (newest application
  // first). Users opt into name/reviewer sort by clicking a column header.
  const sortParam = searchParams.get("sort");
  const sortKey: "none" | "name" | "reviewers" =
    sortParam === "name" ? "name" : sortParam === "reviewers" ? "reviewers" : "none";
  const sortDir: "asc" | "desc" = searchParams.get("dir") === "desc" ? "desc" : "asc";

  const updateParam = (key: string, value: string | null) => {
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev);
      if (!value) sp.delete(key);
      else sp.set(key, value);
      return sp;
    }, { preventScrollReset: true });
  };
  const setFilter = (next: "all" | "finalize") => updateParam("app_filter", next === "all" ? null : next);
  const setQuery = (next: string) => updateParam("q", next.trim() === "" ? null : next);
  const toggleSort = (key: "name" | "reviewers") => {
    if (sortKey === key) {
      // Second click on the active column flips direction; a third click clears
      // the sort and returns to loader order.
      if (sortDir === "asc") {
        updateParam("dir", "desc");
      } else {
        setSearchParams(prev => {
          const sp = new URLSearchParams(prev);
          sp.delete("sort");
          sp.delete("dir");
          return sp;
        }, { preventScrollReset: true });
      }
    } else {
      setSearchParams(prev => {
        const sp = new URLSearchParams(prev);
        sp.set("sort", key);
        sp.delete("dir");
        return sp;
      }, { preventScrollReset: true });
    }
  };

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

  const baseApps = filter === "finalize" ? finalizableApps : apps;
  const lowerQuery = query.trim().toLowerCase();
  const filteredApps = lowerQuery === ""
    ? baseApps
    : baseApps.filter((app: any) => {
        const name = `${app.user.firstName ?? ""} ${app.user.lastName ?? ""}`.toLowerCase();
        return name.includes(lowerQuery);
      });
  const reviewerScore = (app: any) => {
    const reviews = app.domainApplications?.[0]?.reviews ?? [];
    const submitted = reviews.filter((r: any) => r.submittedAt).length;
    return submitted * 10000 + reviews.length;
  };
  const sortedApps = sortKey === "none"
    ? filteredApps
    : [...filteredApps].sort((a: any, b: any) => {
        let cmp = 0;
        if (sortKey === "name") {
          const an = `${a.user.firstName ?? ""} ${a.user.lastName ?? ""}`.toLowerCase();
          const bn = `${b.user.firstName ?? ""} ${b.user.lastName ?? ""}`.toLowerCase();
          cmp = an.localeCompare(bn);
        } else {
          cmp = reviewerScore(a) - reviewerScore(b);
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
  const displayedApps = sortedApps;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 sm:px-6 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-2">
        {isUnderReview && (
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                filter === "all" ? "bg-accent-coral text-white shadow-sm" : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              All Applicants ({apps.length})
            </button>
            <button
              onClick={() => setFilter("finalize")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                filter === "finalize" ? "bg-accent-coral text-white shadow-sm" : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              Needs Finalization ({finalizableApps.length})
            </button>
          </div>
        )}
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search applicants..."
            aria-label="Search applicants by name"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {(query || sortKey !== "none") && (
          <button
            type="button"
            onClick={() => {
              setSearchParams(prev => {
                const sp = new URLSearchParams(prev);
                sp.delete("q");
                sp.delete("sort");
                sp.delete("dir");
                return sp;
              }, { preventScrollReset: true });
            }}
            className="text-xs text-muted-foreground hover:text-foreground/80"
          >
            Reset
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {displayedApps.length} of {baseApps.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
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
                    await fetch(`/api/hiring/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
                  }
                }
                revalidator.revalidate();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-coral hover:bg-accent-coral/90 text-white transition"
            >
              Finalize All ({finalizableApps.length})
            </button>
          )}
          {currentStatus === "UnderReview" && (
            <button
              onClick={async () => {
                const res = await fetch(`/api/hiring/cycles/${cycleId}/domains/${domainId}/auto-assign`, {
                  method: "POST", credentials: "include",
                });
                if (res.ok) {
                  revalidator.revalidate();
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
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-muted/70 text-foreground border border-border transition disabled:opacity-50"
            >
              Auto-Assign Reviewers
            </button>
          )}
        </div>
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="px-6 py-3 text-left">
              <button
                type="button"
                onClick={() => toggleSort("name")}
                className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground/80"
                aria-label={`Sort by applicant name (${sortKey === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "not sorted"})`}
              >
                Applicant
                {sortKey === "name" && (sortDir === "asc"
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />)}
              </button>
            </th>
            <th className="px-6 py-3 text-left">
              <button
                type="button"
                onClick={() => toggleSort("reviewers")}
                className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground/80"
                aria-label={`Sort by reviewer progress (${sortKey === "reviewers" ? (sortDir === "asc" ? "ascending" : "descending") : "not sorted"})`}
              >
                Reviewers
                {sortKey === "reviewers" && (sortDir === "asc"
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />)}
              </button>
            </th>
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
            const currentId = currentDecisionId(decisions);
            const prePill = da && pills.length === 0
              ? synthesizePrePipelinePill({
                  application: { statusUpdates: app.statusUpdates ?? [] },
                  interviews: da.interviews ?? [],
                  decisions,
                })
              : null;
            const daId = da?.id as string | undefined;
            return (
              <tr key={app.id} className="hover:bg-muted/50">
                <td className="px-6 py-4 font-medium">
                  {daId ? (
                    <Link
                      to={`/hiring/domain-lead/application/${daId}`}
                      onClick={(e) => {
                        const url = `/hiring/domain-lead/application/${daId}`
                        const label = `${app.user.firstName ?? ''} ${app.user.lastName ?? ''}`.trim() || 'Applicant'
                        if (requestOpenTabIfEmbedded(url, label)) e.preventDefault()
                      }}
                      className="text-foreground hover:text-accent-coral hover:underline"
                    >
                      {app.user.firstName} {app.user.lastName}
                    </Link>
                  ) : (
                    <span className="text-foreground">{app.user.firstName} {app.user.lastName}</span>
                  )}
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
                        <DecisionPillBadge key={i} pill={pill} isCurrent={!!pill.id && pill.id === currentId} />
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
                  {isUnderReview && draftToFinalize ? (
                    <button
                      onClick={() => handleFinalize(draftToFinalize.id)}
                      disabled={finalizingId === draftToFinalize.id}
                      className="px-2 py-1 text-xs font-medium rounded bg-accent-coral hover:bg-accent-coral/90 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {finalizingId === draftToFinalize.id ? "Finalizing…" : "Finalize"}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  )}
                  </div>
                </td>
              </tr>
            );
          })}
          {displayedApps.length === 0 && (
            <tr><td colSpan={isUnderReview && canAssignReviewers ? 5 : 4} className="px-6 py-8 text-center text-muted-foreground/70 text-sm">
              {filter === "finalize" ? "No applications need finalization." : "No applications."}
            </td></tr>
          )}
        </tbody>
      </table>
      </div>
      <ul className="sm:hidden divide-y divide-gray-100">
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
          const currentId = currentDecisionId(decisions);
          const prePill = da && pills.length === 0
            ? synthesizePrePipelinePill({
                application: { statusUpdates: app.statusUpdates ?? [] },
                interviews: da.interviews ?? [],
                decisions,
              })
            : null;
          const daId = da?.id as string | undefined;
          return (
            <li key={app.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                {daId ? (
                  <Link
                    to={`/hiring/domain-lead/application/${daId}`}
                    onClick={(e) => {
                      const url = `/hiring/domain-lead/application/${daId}`
                      const label = `${app.user.firstName ?? ''} ${app.user.lastName ?? ''}`.trim() || 'Applicant'
                      if (requestOpenTabIfEmbedded(url, label)) e.preventDefault()
                    }}
                    className="font-medium text-foreground hover:text-accent-coral hover:underline"
                  >
                    {app.user.firstName} {app.user.lastName}
                  </Link>
                ) : (
                  <div className="font-medium text-foreground">
                    {app.user.firstName} {app.user.lastName}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Reviewers</div>
                <ReviewerAssignmentCell
                  domainApplicationId={da?.id}
                  reviews={reviews}
                  cycleReviewers={cycleReviewersForDomain}
                  editable={isUnderReview && canAssignReviewers}
                  rubricCriteria={rubricCriteria}
                />
              </div>
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Decisions</div>
                {pills.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {pills.map((pill, i) => (
                      <DecisionPillBadge key={i} pill={pill} isCurrent={!!pill.id && pill.id === currentId} />
                    ))}
                  </div>
                ) : prePill ? (
                  <PrePipelinePillBadge pill={prePill} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              {isUnderReview && draftToFinalize && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleFinalize(draftToFinalize.id)}
                    disabled={finalizingId === draftToFinalize.id}
                    className="px-2 py-1 text-xs font-medium rounded bg-accent-coral hover:bg-accent-coral/90 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {finalizingId === draftToFinalize.id ? "Finalizing…" : "Finalize"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {displayedApps.length === 0 && (
          <li className="px-6 py-8 text-center text-muted-foreground/70 text-sm">
            {filter === "finalize" ? "No applications need finalization." : "No applications."}
          </li>
        )}
      </ul>
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
  const [pendingRemoveReview, setPendingRemoveReview] = useState<any | null>(null);

  // Resync from props after the loader revalidates (e.g. when bulk auto-assign
  // adds reviewers to this row). Without this, the pills shown here would lag
  // behind server state until a hard reload.
  useEffect(() => { setLocalReviews(reviews); }, [reviews]);

  const assignedReviewerIds = new Set(localReviews.map((r: any) => r.cycleReviewerId));
  const available = cycleReviewers.filter((cr: any) => !assignedReviewerIds.has(cr.id));

  async function addReviewer() {
    if (!domainApplicationId || !selectedReviewerId) return;
    try {
      const res = await fetch(`/api/hiring/domain-applications/${domainApplicationId}/reviews`, {
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

  async function performRemoveReview(reviewId: string) {
    setRemoving(reviewId);
    try {
      const res = await fetch(`/api/hiring/reviews/${reviewId}`, {
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

  function requestRemoveReview(review: any) {
    if (getReviewStatus(review) === "submitted") {
      setPendingRemoveReview(review);
    } else {
      performRemoveReview(review.id);
    }
  }

  const cellClass = editable && adding
    ? "flex flex-wrap items-center gap-1 border-2 border-blue-400/50 bg-blue-50 dark:bg-blue-900/20 rounded-md p-1"
    : "flex flex-wrap items-center gap-1";
  return (
    <div className={cellClass}>
      {localReviews.map((r: any) => {
        const m = r.cycleReviewer?.user;
        const name = m?.firstName && m?.lastName
          ? `${m.firstName} ${m.lastName[0]}.`
          : m?.daliEmail ?? "?";
        const fullName = m?.firstName && m?.lastName
          ? `${m.firstName} ${m.lastName}`
          : m?.daliEmail ?? "Reviewer";
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
        const recommendation = r.overallRecommendation ? `, recommends ${r.overallRecommendation.toLowerCase()}` : "";
        const tooltip =
          status === "submitted"
            ? `${fullName} — submitted${recommendation}. Click to view scores and feedback.`
            : status === "inProgress"
              ? `${fullName} — review in progress. Click to view partial scores.`
              : `${fullName} — assigned but not started yet.`;
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
            title={tooltip}
            aria-label={tooltip}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border cursor-pointer hover:brightness-95 transition ${pillClass}`}
          >
            {icon}
            {name}
            {editable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  requestRemoveReview(r);
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
          <span className="text-[10px] uppercase tracking-wide font-bold text-blue-700 dark:text-blue-300">
            Adding reviewer
          </span>
          <select
            value={selectedReviewerId}
            onChange={e => setSelectedReviewerId(e.target.value)}
            className="rounded border border-border bg-card text-card-foreground px-1.5 py-0.5 text-xs"
            autoFocus
          >
            <option value="">Select...</option>
            {available.map((cr: any) => {
              const m = cr.user;
              const label = m?.firstName && m?.lastName
                ? `${m.firstName} ${m.lastName}`
                : m?.daliEmail ?? cr.id;
              return <option key={cr.id} value={cr.id}>{label}</option>;
            })}
          </select>
          <button
            onClick={addReviewer}
            disabled={!selectedReviewerId}
            className="px-1.5 py-0.5 text-xs font-medium rounded bg-accent-teal text-white hover:bg-accent-teal/90 disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setSelectedReviewerId(""); }}
            className="px-1.5 py-0.5 text-xs font-medium rounded border border-border bg-card text-foreground hover:bg-muted/50"
          >
            Cancel
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
      <ConfirmDialog
        open={!!pendingRemoveReview}
        title="Remove this reviewer's submitted review?"
        body={
          <p>
            <strong>
              {(() => {
                const m = pendingRemoveReview?.cycleReviewer?.user;
                if (!m) return "This reviewer";
                return m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : (m.daliEmail ?? "This reviewer");
              })()}
            </strong>{" "}
            has already submitted their review. Removing them will permanently delete their scores and feedback.
          </p>
        }
        confirmLabel="Remove and delete review"
        destructive
        onCancel={() => setPendingRemoveReview(null)}
        onConfirm={() => {
          const r = pendingRemoveReview;
          setPendingRemoveReview(null);
          if (r) performRemoveReview(r.id);
        }}
      />
    </div>
  );
}

function ReviewModal({ review, rubricCriteria, onClose }: {
  review: any;
  rubricCriteria: any[];
  onClose: () => void;
}) {
  const m = review.cycleReviewer?.user;
  const reviewerName = m?.firstName && m?.lastName
    ? `${m.firstName} ${m.lastName}`
    : m?.daliEmail ?? "Reviewer";
  const isSubmitted = !!review.submittedAt;
  const scoreEntries = Object.entries((review.scores as Record<string, number>) ?? {});
  const criteriaByKey: Record<string, { label: string; description?: string; maxScore?: number }> = {};
  for (const c of rubricCriteria ?? []) {
    if (c?.key) criteriaByKey[c.key] = { label: c.label ?? c.key, description: c.description, maxScore: c.maxScore };
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
              {review.overallRecommendation && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Recommendation
                  </h3>
                  <span className="inline-flex px-2.5 py-1 rounded-full text-sm font-bold bg-blue-50 text-blue-700 border border-blue-200">
                    {review.overallRecommendation}
                  </span>
                </div>
              )}
              {scoreEntries.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Scores
                  </h3>
                  <div className="space-y-2">
                    {scoreEntries.map(([key, score]) => {
                      const criterion = criteriaByKey[key];
                      return (
                        <div key={key} className="bg-muted/50 rounded px-3 py-2">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-foreground/80">
                              {criterion?.label ?? key}
                            </span>
                            <span className="font-semibold text-foreground whitespace-nowrap">
                              {score}
                              {criterion?.maxScore != null && (
                                <span className="font-normal text-muted-foreground"> / {criterion.maxScore}</span>
                              )}
                            </span>
                          </div>
                          {criterion?.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{criterion.description}</p>
                          )}
                        </div>
                      );
                    })}
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

