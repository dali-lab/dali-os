import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/domain-lead.application.$id";
import { prisma } from "~/lib/db";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { requireAuth } from "~/lib/auth";
import { isDomainLeadForCycle } from "~/lib/roles";
import { redirectToLogin } from "~/lib/login-next";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { presignAnswers } from "~/hiring/lib/presign";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { safeParseJsonString } from "~/forms/lib/forms-data";
import { ChevronDown } from "lucide-react";
import { Tooltip, InfoTip } from "~/components/ui/floating";
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
  ApplicationTimeline,
  StageMoveControl,
} from "~/hiring/components/ApplicationTimeline";
import { Pill, type PillTone, SetupCard } from "~/hiring/components/cycle-setup/SetupCard";
import { buildApplicationTimeline } from "~/hiring/lib/application-timeline";
import { findRound, parseTimeline } from "~/hiring/lib/cycle-timeline";
import { buildCriteriaLabelMap } from "~/hiring/lib/rubric-criteria";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "~/hiring/lib/domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { Question } from "~/types";
import { RECOMMENDATION_TONES } from "~/hiring/lib/labels";

// One status per application, in the shared pill vocabulary: the dot carries
// the state and the chip stays quiet.
const STATUS_BADGE: Record<string, { tone: PillTone; label: string }> = {
  ApplicationOpen: { tone: "neutral", label: "Draft" },
  Pending: { tone: "warning", label: "Pending review" },
  Rejected: { tone: "danger", label: "Rejected" },
  InvitedToInterview: { tone: "accent", label: "Invited to interview" },
  InterviewScheduled: { tone: "accent", label: "Interview scheduled" },
  PostInterviewPending: { tone: "accent", label: "Post-interview" },
  Accepted: { tone: "success", label: "Accepted" },
  AcceptedElsewhere: { tone: "neutral", label: "Accepted elsewhere" },
  Waitlisted: { tone: "warning", label: "Waitlisted" },
};

export const meta: Route.MetaFunction = ({ data }) => {
  const user = (data as any)?.application?.user;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return [{ title: `${name || "Application"} · Domain lead · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const domainLeadAssignments = await prisma.domainLeadAssignment.findMany({
    where: { userId: auth.user.sub },
    select: { domainId: true },
  });

  if (domainLeadAssignments.length === 0) {
    return redirect("/hiring");
  }

  const leadDomainIds = domainLeadAssignments.map((a) => a.domainId);

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      ...domainApplicationStatusInclude,
      challengeFormVersion: { select: { questions: true, intro: true, form: { select: { name: true } } } },
      domain: true,
      application: {
        include: {
          user: true,
          statusUpdates: true,
          applicationFormVersion: true,
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
  const daDomainId = da.domainId ?? null;
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
    request,
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

  // Delibs boards reference applicants inside columnOrder JSON, not by FK, so
  // find this application's column on each of the domain's boards.
  const [delibsSessions, cycleTimelineRow, canMoveStage] = await Promise.all([
    prisma.delibsSession.findMany({
      where: { domainId: daDomainId, applicationCycleId: da.application.applicationCycleId },
      select: { id: true, roundId: true, status: true, columnOrder: true, updatedAt: true },
    }),
    prisma.applicationCycle.findUnique({
      where: { id: da.application.applicationCycleId },
      select: { timeline: true },
    }),
    // The same rule the decisions endpoint enforces: this page is already
    // limited to leads of this domain, so only the Core-cycle carve-out is left.
    isDomainLeadForCycle(auth.user.sub, da.application.applicationCycleId),
  ]);
  const cycleTimeline = parseTimeline(cycleTimelineRow?.timeline);
  const delibs = delibsSessions
    .map((s) => {
      const cols = (s.columnOrder ?? {}) as Record<string, unknown>;
      let column: string | null = null;
      for (const [name, ids] of Object.entries(cols)) {
        if (Array.isArray(ids) && ids.includes(da.id)) {
          column = name;
          break;
        }
      }
      return {
        id: s.id,
        label: findRound(cycleTimeline, s.roundId)?.label ?? "Delib round",
        status: s.status,
        column,
        updatedAt: s.updatedAt.toISOString(),
      };
    })
    .filter((s) => s.column !== null);

  // A domain lead sees everything on their own applications, so no entry is
  // filtered out here.
  const timeline = buildApplicationTimeline({
    statusUpdates: da.application.statusUpdates,
    decisions: (da.decisions ?? []).map((d: any) => ({
      id: d.id,
      type: d.type,
      stage: d.stage,
      notes: d.notes,
      waitlistRank: d.waitlistRank,
      createdAt: d.createdAt,
      madeByName:
        [d.madeBy?.firstName, d.madeBy?.lastName].filter(Boolean).join(" ").trim() || null,
    })),
    delibs,
    interviews: (da.interviews ?? []).map((iv: any) => ({
      id: iv.id,
      startTime: iv.startTime,
      endTime: iv.endTime,
      status: iv.status,
    })),
  });

  const cycleStatus = (da.application.applicationCycle.statusUpdates[0]?.newStatus ?? "Draft") as ApplicationCycleStatus;
  const inferredStatus = inferDomainApplicationStatus(
    { ...da, application: { statusUpdates: da.application.statusUpdates } } as any,
    cycleStatus,
  );

  // Presign file-type answers so reviewers see real download links rather than raw S3 keys.
  const generalQuestions =
    (da.application.applicationFormVersion?.questions as unknown as Question[]) ?? [];
  const challengeQuestions =
    (da.challengeFormVersion?.questions as unknown as Question[]) ?? [];
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
        // Per-domain challenge: synthesize from the bound Drive Form.
        challengeVersion: da.challengeFormVersion
          ? {
              questions: da.challengeFormVersion.questions,
              description: ensureBlocks(safeParseJsonString(da.challengeFormVersion.intro)),
              domain: da.domain ?? { name: "Domain" },
              challenge: { name: da.challengeFormVersion.form?.name ?? "Challenge" },
            }
          : null,
        answers: presignedChallengeAnswers,
        interviews: interviewsWithNotes,
        reviews: reviewsWithPhotos,
      },
      application: {
        ...da.application,
        answers: presignedGeneralAnswers,
        // Synthesize generalChallengeVersion from the bound Drive Form.
        generalChallengeVersion: da.application.applicationFormVersion
          ? {
              questions: da.application.applicationFormVersion.questions,
              description: ensureBlocks(safeParseJsonString(da.application.applicationFormVersion.intro)),
            }
          : null,
      },
      inferredStatus,
      criteriaByKey,
      timeline,
      canMoveStage,
    };
}

export default function DomainLeadApplicationView() {
  const { domainApplication: da, application, inferredStatus, criteriaByKey, timeline, canMoveStage } =
    useLoaderData<typeof loader>() as any;

  const generalQuestions: any[] = application.generalChallengeVersion?.questions ?? [];
  const challengeQuestions: any[] = da.challengeVersion?.questions ?? [];
  const reviews: any[] = da.reviews ?? [];
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
              challenge: da.challengeVersion.challenge ?? null,
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
        domainName={da.domain?.name ?? da.challengeVersion?.domain?.name}
        cycleName={application.applicationCycle.name}
        statusSlot={
          <Pill dot={statusInfo.tone}>
            {statusInfo.label}
            {inferredStatus === "AcceptedElsewhere" && (
              <InfoTip content="This applicant accepted an offer from another DALI domain, so this application is closed and their other pending applications are withdrawn." />
            )}
          </Pill>
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

          {/* Every stage change in one list: delibs, interviews, decisions.
              The move control sits in the body, not the title row: this column
              is too narrow for a select beside the heading. */}
          <SetupCard title="Decisions" description="Every stage change, oldest first.">
            {canMoveStage && <StageMoveControl domainApplicationId={da.id} />}
            <ApplicationTimeline entries={timeline} />
          </SetupCard>
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
          <Pill dot={isSubmitted ? "success" : "warning"}>
            {isSubmitted ? "Submitted" : "In progress"}
          </Pill>
        </div>
        {review.overallRecommendation && (
          <Pill dot={RECOMMENDATION_TONES[review.overallRecommendation] ?? "neutral"}>
            {review.overallRecommendation}
          </Pill>
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
              <Tooltip key={key} content={label}>
                <span className="text-xs bg-muted text-foreground/80 px-1.5 py-0.5 rounded">
                  {label.split(" ")[0]}: {score}
                  {meta?.maxScore != null ? `/${meta.maxScore}` : ""}
                </span>
              </Tooltip>
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
