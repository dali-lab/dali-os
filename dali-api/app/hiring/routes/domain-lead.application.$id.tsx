import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/domain-lead.application.$id";
import { prisma } from "~/lib/db";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { presignAnswers } from "~/hiring/lib/presign";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { ChevronDown } from "lucide-react";
import { resolvePhotoUrl } from "~/lib/photo";
import { Avatar } from "~/components/ui/Avatar";
import { ApplicationViewer } from "~/hiring/components/ApplicationViewer";
import { ReviewSummary } from "~/hiring/components/ReviewSummary";
import { DetailCard } from "~/hiring/components/DetailCard";
import { ApplicantDetailHeader } from "~/hiring/components/ApplicantDetailHeader";
import {
  InterviewNotesCard,
  type InterviewNotesData,
} from "~/hiring/components/InterviewNotesCard";
import {
  DecisionHistoryList,
  type DecisionHistoryRow,
} from "~/hiring/components/DecisionHistoryList";
import { buildCriteriaLabelMap } from "~/hiring/lib/rubric-criteria";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "~/hiring/lib/domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { Question } from "~/types";
import { RECOMMENDATION_COLORS } from "~/hiring/lib/labels";

// bg + text + an explicit same-hue border (e.g. red pill → red border), so the
// outline always matches the pill and never falls back to the neutral gray
// border from the global `*` rule. Mirrors the dashboard's DECISION_COLORS:
// `-300` light borders read clearly (not the faint `-200`), with dark variants.
const STATUS_BADGE: Record<string, { bg: string; label: string }> = {
  ApplicationOpen: { bg: "bg-muted text-foreground/80 border-current/30", label: "Draft" },
  Pending: { bg: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:border-yellow-700", label: "Pending Review" },
  Rejected: { bg: "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700", label: "Rejected" },
  InvitedToInterview: { bg: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700", label: "Invited to Interview" },
  InterviewScheduled: { bg: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700", label: "Interview Scheduled" },
  PostInterviewPending: { bg: "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-700", label: "Post-Interview" },
  Accepted: { bg: "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700", label: "Accepted" },
  Waitlisted: { bg: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700", label: "Waitlisted" },
};

export const meta: Route.MetaFunction = ({ data }) => {
  const user = (data as any)?.application?.user;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return [{ title: `${name || "Application"} · Domain lead · DALI OS` }];
};

export const handle = {
  breadcrumb: (data: unknown) => {
    const user = (
      data as
        | { application?: { user?: { firstName?: string; lastName?: string } } }
        | undefined
    )?.application?.user;
    return (
      [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
      undefined
    );
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const domainLeadAssignments = await prisma.domainLeadAssignment.findMany({
    where: { userId: auth.user.sub },
    select: { domainId: true },
  });

  if (domainLeadAssignments.length === 0) {
    return redirect("/hiring/reviewer");
  }

  const leadDomainIds = domainLeadAssignments.map((a) => a.domainId);

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      ...domainApplicationStatusInclude,
      challengeVersion: { include: { domain: true, challenge: true } },
      domain: true,
      application: {
        include: {
          user: true,
          statusUpdates: true,
          generalChallengeVersion: true,
          internToFullFormVersion: true,
          applicationCycle: {
            include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
          },
        },
      },
      reviews: {
        include: {
          cycleReviewer: {
            include: { user: { select: { firstName: true, lastName: true, photoUrl: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      decisions: {
        orderBy: { createdAt: "desc" },
        include: { madeBy: { select: { firstName: true, lastName: true } } },
      },
      interviews: {
        where: { status: { in: ["Scheduled", "Completed"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          assignments: {
            where: { status: "Active" },
            include: {
              cycleInterviewer: {
                include: { user: { select: { firstName: true, lastName: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!da) return redirect("/hiring/domain-lead");
  // Standard cycles link domain via challengeVersion. InternToFull links it
  // directly. Use whichever is present.
  const daDomainId = da.challengeVersion?.domainId ?? da.domainId ?? null;
  if (!daDomainId || !leadDomainIds.includes(daDomainId)) return redirect("/hiring/domain-lead");

  const confRedirect = await requirePageSignedOrRedirect(
    auth.user.sub,
    da.application.applicationCycleId,
    request,
  );
  if (confRedirect) return confRedirect;

  // After the domain + confidentiality gates — this application lands in the
  // lead's recents, keyed to the applicant's name.
  recordRouteVisit(
    auth.user.sub,
    `/hiring/domain-lead/application/${params.id}`,
    `${da.application.user.firstName} ${da.application.user.lastName}`.trim(),
  );

  // Resolve criterion-key -> label for score display. Prefers the current
  // domain rubric, but falls back to the version pinned on each review (and
  // rubric history) so scores keyed by an older rubric version still resolve.
  const dac = daDomainId
    ? await prisma.domainApplicationCycle.findUnique({
        where: {
          domainId_applicationCycleId: {
            domainId: daDomainId,
            applicationCycleId: da.application.applicationCycleId,
          },
        },
        select: { rubricVersionId: true },
      })
    : null;

  const generalRubric = await prisma.applicationCycle.findUnique({
    where: { id: da.application.applicationCycleId },
    select: { generalRubricVersion: { select: { criteria: true } } },
  });

  const criteriaByKey = await buildCriteriaLabelMap({
    domainRubricVersionId: dac?.rubricVersionId ?? null,
    generalCriteria: generalRubric?.generalRubricVersion?.criteria,
    pinnedVersionIds: (da.reviews ?? []).map((r: any) => r.rubricVersionId),
  });

  // Interview notes live in CollabDocumentVersion (Yjs/BlockNote), keyed by doc
  // name — mirror the unified applicant-detail view. Two kinds per interview:
  //   interview:{id}:notes                     — joint, shared by interviewers
  //   interview:{id}:rec-notes-{assignmentId}  — per-interviewer rec notes
  // A domain lead is a pre-release-decision viewer (access is already gated to
  // their domains above), so both kinds are surfaced here.
  const interviewRows = da.interviews ?? [];
  const collabDocNames: string[] = [];
  for (const iv of interviewRows) {
    collabDocNames.push(`interview:${iv.id}:notes`);
    for (const a of iv.assignments) {
      collabDocNames.push(`interview:${iv.id}:rec-notes-${a.id}`);
    }
  }
  const collabVersionRows = collabDocNames.length > 0
    ? await prisma.collabDocumentVersion.findMany({
        where: { name: { in: collabDocNames } },
        orderBy: { createdAt: "desc" },
        select: { name: true, plainText: true, createdAt: true },
      })
    : [];
  // Keep only the latest snapshot per doc name.
  const latestCollabByName = new Map<string, string>();
  for (const row of collabVersionRows) {
    if (!latestCollabByName.has(row.name)) {
      latestCollabByName.set(row.name, row.plainText);
    }
  }
  // Attach resolved notes onto the interview object the component reads.
  const interviewsWithNotes = interviewRows.map((iv: any) => ({
    ...iv,
    jointNotes: latestCollabByName.get(`interview:${iv.id}:notes`)?.trim() || null,
    assignments: iv.assignments.map((a: any) => ({
      ...a,
      recNotes:
        latestCollabByName.get(`interview:${iv.id}:rec-notes-${a.id}`)?.trim() || null,
    })),
  }));

  const cycleStatus = (da.application.applicationCycle.statusUpdates[0]?.newStatus ?? "Draft") as ApplicationCycleStatus;
  const inferredStatus = inferDomainApplicationStatus(
    { ...da, application: { statusUpdates: da.application.statusUpdates } } as any,
    cycleStatus,
  );

  // Presign file-type answers so reviewers see real download links rather
  // than raw S3 keys.
  const generalQuestions =
    (da.application.generalChallengeVersion?.questions as unknown as Question[]) ?? [];
  const challengeQuestions =
    (da.challengeVersion?.questions as unknown as Question[]) ?? [];
  const presignedGeneralAnswers = await presignAnswers(
    generalQuestions,
    da.application.answers as Record<string, string>,
  );
  const presignedChallengeAnswers = await presignAnswers(
    challengeQuestions,
    da.answers as Record<string, string>,
  );

  // Resolve reviewer avatars (raw photoUrl is an S3 key) for the review cards.
  const reviewsWithPhotos = await Promise.all(
    (da.reviews ?? []).map(async (r: any) => ({
      ...r,
      reviewerPhotoUrl: await resolvePhotoUrl(r.cycleReviewer?.user?.photoUrl),
    })),
  );

  return {
      domainApplication: {
        ...da,
        // Immutable ChallengeVersion rows: legacy ProseMirror descriptions
        // convert to block JSON on read (ApplicationViewer expects blocks).
        challengeVersion: da.challengeVersion
          ? { ...da.challengeVersion, description: ensureBlocks(da.challengeVersion.description) }
          : da.challengeVersion,
        answers: presignedChallengeAnswers,
        interviews: interviewsWithNotes,
        reviews: reviewsWithPhotos,
      },
      application: {
        ...da.application,
        answers: presignedGeneralAnswers,
        generalChallengeVersion: da.application.generalChallengeVersion
          ? {
              ...da.application.generalChallengeVersion,
              description: ensureBlocks(da.application.generalChallengeVersion.description),
            }
          : da.application.generalChallengeVersion,
      },
      inferredStatus,
      criteriaByKey,
    };
}

export default function DomainLeadApplicationView() {
  const { domainApplication: da, application, inferredStatus, criteriaByKey } =
    useLoaderData<typeof loader>() as any;

  const generalQuestions: any[] = application.generalChallengeVersion?.questions ?? [];
  const challengeQuestions: any[] = da.challengeVersion?.questions ?? [];
  const reviews: any[] = da.reviews ?? [];
  const decisions: any[] = da.decisions ?? [];
  const interview = da.interviews?.[0] ?? null;
  const statusInfo = STATUS_BADGE[inferredStatus] ?? STATUS_BADGE.Pending;

  const questionLabels: Record<string, string> = {};
  for (const q of [...generalQuestions, ...challengeQuestions]) {
    if (q?.key) questionLabels[q.key] = q.data?.label ?? q.key;
  }
  const viewerApplication = {
    answers: application.answers ?? {},
    generalChallengeVersion: application.generalChallengeVersion
      ? {
          questions: application.generalChallengeVersion.questions ?? [],
          description: application.generalChallengeVersion.description,
        }
      : null,
    domainApplications: [
      {
        id: da.id,
        answers: da.answers ?? {},
        challengeVersion: da.challengeVersion
          ? {
              questions: da.challengeVersion.questions ?? [],
              description: da.challengeVersion.description,
              domain: da.challengeVersion.domain ?? { name: "Domain" },
              challenge: da.challengeVersion.challenge,
            }
          : null,
        domain: da.domain,
      },
    ],
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <ApplicantDetailHeader
        name={`${application.user.firstName} ${application.user.lastName}`}
        domainName={da.challengeVersion.domain?.name}
        cycleName={application.applicationCycle.name}
        statusSlot={
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${statusInfo.bg}`}>
            {statusInfo.label}
          </span>
        }
      />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Application content */}
        <div className="lg:col-span-2">
          <ApplicationViewer
            application={viewerApplication}
            questionLabels={questionLabels}
            readOnly
          />
        </div>

        {/* Right: Context sidebar */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {/* Reviews */}
          <DetailCard
            title="Reviews"
            subtitle={
              reviews.length === 0
                ? "No reviewers assigned yet."
                : `${reviews.filter((r: any) => r.submittedAt).length}/${reviews.length} submitted`
            }
            className="overflow-hidden"
          >
            {reviews.length > 0 && (
              <div className="divide-y divide-gray-100">
                {reviews.map((review: any) => (
                  <ReviewCard key={review.id} review={review} criteriaByKey={criteriaByKey} />
                ))}
              </div>
            )}
          </DetailCard>

          {/* Interview */}
          {interview && (
            <DetailCard title="Interview" className="overflow-hidden">
              <InterviewNotesCard interview={toInterviewNotesData(interview)} variant="compact" />
            </DetailCard>
          )}

          {/* Decision history */}
          {decisions.length > 0 && (
            <DetailCard title="Decision History" className="overflow-hidden">
              <DecisionHistoryList decisions={decisions.map(toDecisionHistoryRow)} />
            </DetailCard>
          )}
        </div>
      </div>
    </div>
  );
}

// Map this route's interview shape (joint notes as a plain string, recNotes
// per assignment) into the shared InterviewNotesCard prop shape.
function toInterviewNotesData(interview: any): InterviewNotesData {
  return {
    id: interview.id,
    startTime: interview.startTime,
    endTime: interview.endTime,
    status: interview.status,
    recommendation: interview.recommendation,
    recommendationNotes: interview.recommendationNotes,
    jointNotes: interview.jointNotes ?? null,
    interviewers: (interview.assignments ?? []).map((a: any) => {
      const m = a.cycleInterviewer?.user;
      return {
        id: a.id,
        name: m ? `${m.firstName} ${m.lastName}` : "Interviewer",
        notes: a.recNotes ?? null,
      };
    }),
  };
}

function toDecisionHistoryRow(d: any): DecisionHistoryRow {
  return {
    id: d.id,
    type: d.type,
    stage: d.stage,
    waitlistRank: d.waitlistRank,
    createdAt: d.createdAt,
  };
}

function ReviewCard({
  review,
  criteriaByKey,
}: {
  review: any;
  criteriaByKey: Record<string, { label: string; maxScore?: number }>;
}) {
  // Reviewer feedback is shown open by default — domain leads want to read it
  // at a glance, not click into each review.
  const [expanded, setExpanded] = useState(true);
  const reviewer = review.cycleReviewer?.user;
  const name = reviewer ? `${reviewer.firstName} ${reviewer.lastName}` : "Unknown";
  const isSubmitted = !!review.submittedAt;
  const scores = (review.scores ?? {}) as Record<string, number>;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar photoUrl={review.reviewerPhotoUrl} name={name} size="sm" className="shrink-0" />
          <span className="text-sm font-medium text-foreground">{name}</span>
          {isSubmitted ? (
            <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded font-medium">Submitted</span>
          ) : (
            <span className="text-xs text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded font-medium">In Progress</span>
          )}
        </div>
        {review.overallRecommendation && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${RECOMMENDATION_COLORS[review.overallRecommendation] ?? "bg-muted text-foreground/80"}`}>
            {review.overallRecommendation}
          </span>
        )}
      </div>

      {/* Scores summary — iterate the review's own score keys so a score
          survives even if its criterion was edited out of the current rubric;
          the resolver supplies the label from the pinned/historical version. */}
      {Object.keys(scores).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(scores).map(([key, score]) => {
            if (score == null) return null;
            const meta = criteriaByKey[key];
            const label = meta?.label ?? key;
            return (
              <span key={key} className="text-xs bg-muted text-foreground/80 px-1.5 py-0.5 rounded" title={label}>
                {label.split(" ")[0]}: {score}
                {meta?.maxScore != null ? `/${meta.maxScore}` : ""}
              </span>
            );
          })}
        </div>
      )}

      {/* Expandable feedback */}
      {(review.feedback || review.rejectionRationale) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-accent-coral hover:text-accent-coral/80 flex items-center gap-1"
        >
          {expanded ? "Hide" : "Show"} feedback
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
      {expanded && (
        <div className="mt-2">
          <ReviewSummary
            feedback={review.feedback}
            rejectionRationale={review.rejectionRationale}
          />
        </div>
      )}
    </div>
  );
}
