import { useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/domain-lead.application.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { presignAnswers } from "~/hiring/lib/presign";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { ApplicationViewer } from "~/hiring/components/ApplicationViewer";
import { ReviewSummary } from "~/hiring/components/ReviewSummary";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "~/hiring/lib/domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { Question } from "~/types";

const RECOMMENDATION_COLORS: Record<string, string> = {
  "Strong Hire": "bg-green-100 text-green-800",
  Hire: "bg-green-50 text-green-700",
  "Lean Hire": "bg-yellow-50 text-yellow-700",
  "Lean No Hire": "bg-orange-50 text-orange-700",
  "No Hire": "bg-red-100 text-red-700",
};

const STATUS_BADGE: Record<string, { bg: string; label: string }> = {
  ApplicationOpen: { bg: "bg-muted text-foreground/80", label: "Draft" },
  Pending: { bg: "bg-yellow-100 text-yellow-800", label: "Pending Review" },
  Rejected: { bg: "bg-red-100 text-red-700", label: "Rejected" },
  InvitedToInterview: { bg: "bg-blue-100 text-blue-700", label: "Invited to Interview" },
  InterviewScheduled: { bg: "bg-blue-100 text-blue-700", label: "Interview Scheduled" },
  PostInterviewPending: { bg: "bg-purple-100 text-purple-700", label: "Post-Interview" },
  Accepted: { bg: "bg-green-100 text-green-700", label: "Accepted" },
  Waitlisted: { bg: "bg-yellow-100 text-yellow-700", label: "Waitlisted" },
};

const DECISION_COLORS: Record<string, string> = {
  Rejected: "bg-red-100 text-red-700",
  InvitedToInterview: "bg-blue-100 text-blue-700",
  Accepted: "bg-green-100 text-green-700",
  Waitlisted: "bg-yellow-100 text-yellow-700",
};

const STAGE_LABELS: Record<string, string> = {
  Draft: "Draft",
  Final: "Finalized",
  Released: "Released",
};

export const meta: Route.MetaFunction = ({ data }) => {
  const user = (data as any)?.application?.user;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return [{ title: `${name || "Application"} · Domain lead · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

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
            include: { user: { select: { firstName: true, lastName: true } } },
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

  // Load rubric criteria for score labels
  const dac = daDomainId
    ? await prisma.domainApplicationCycle.findUnique({
        where: {
          domainId_applicationCycleId: {
            domainId: daDomainId,
            applicationCycleId: da.application.applicationCycleId,
          },
        },
        include: { rubricVersion: true },
      })
    : null;

  const generalRubric = await prisma.applicationCycle.findUnique({
    where: { id: da.application.applicationCycleId },
    select: { generalRubricVersion: true },
  });

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

  return {
      domainApplication: { ...da, answers: presignedChallengeAnswers },
      application: { ...da.application, answers: presignedGeneralAnswers },
      inferredStatus,
      domainRubricCriteria: (dac?.rubricVersion?.criteria as any[]) ?? [],
      generalRubricCriteria: (generalRubric?.generalRubricVersion?.criteria as any[]) ?? [],
    };
}

export default function DomainLeadApplicationView() {
  const { domainApplication: da, application, inferredStatus, domainRubricCriteria, generalRubricCriteria } =
    useLoaderData<typeof loader>() as any;

  const generalQuestions: any[] = application.generalChallengeVersion?.questions ?? [];
  const challengeQuestions: any[] = da.challengeVersion?.questions ?? [];
  const reviews: any[] = da.reviews ?? [];
  const decisions: any[] = da.decisions ?? [];
  const interview = da.interviews?.[0] ?? null;
  const statusInfo = STATUS_BADGE[inferredStatus] ?? STATUS_BADGE.Pending;
  const allCriteria = [...(generalRubricCriteria ?? []), ...(domainRubricCriteria ?? [])];

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            to="/hiring/domain-lead"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground/80"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-2">
            {application.user.firstName} {application.user.lastName}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {da.challengeVersion.domain?.name} · {application.applicationCycle.name}
          </p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${statusInfo.bg}`}>
          {statusInfo.label}
        </span>
      </div>

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
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-muted/50 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">Reviews</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {reviews.length === 0
                  ? "No reviewers assigned yet."
                  : `${reviews.filter((r: any) => r.submittedAt).length}/${reviews.length} submitted`}
              </p>
            </div>
            {reviews.length > 0 && (
              <div className="divide-y divide-gray-100">
                {reviews.map((review: any) => (
                  <ReviewCard key={review.id} review={review} criteria={allCriteria} />
                ))}
              </div>
            )}
          </div>

          {/* Interview */}
          {interview && (
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-muted/50 border-b border-border">
                <h2 className="text-lg font-bold text-foreground">Interview</h2>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {new Date(interview.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
                    {new Date(interview.startTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    interview.status === "Completed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {interview.status}
                  </span>
                </div>
                {interview.recommendation && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Recommendation:</span>{" "}
                    <span className="font-medium text-foreground">{interview.recommendation}</span>
                  </div>
                )}
                {interview.recommendationNotes && (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">{interview.recommendationNotes}</p>
                )}
                {interview.assignments?.length > 0 && (
                  <div className="text-xs text-muted-foreground pt-1">
                    Interviewers: {interview.assignments.map((a: any) => {
                      const m = a.cycleInterviewer?.user;
                      return m ? `${m.firstName} ${m.lastName}` : "?";
                    }).join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Decision history */}
          {decisions.length > 0 && (
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-muted/50 border-b border-border">
                <h2 className="text-lg font-bold text-foreground">Decision History</h2>
              </div>
              <div className="px-4 py-3 space-y-2">
                {decisions.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DECISION_COLORS[d.type] ?? "bg-muted text-foreground/80"}`}>
                        {d.type}
                      </span>
                      <span className="text-xs text-muted-foreground">{STAGE_LABELS[d.stage] ?? d.stage}</span>
                    </div>
                    <span className="text-xs text-muted-foreground/70">
                      {new Date(d.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ review, criteria }: { review: any; criteria: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const reviewer = review.cycleReviewer?.user;
  const name = reviewer ? `${reviewer.firstName} ${reviewer.lastName}` : "Unknown";
  const isSubmitted = !!review.submittedAt;
  const scores = (review.scores ?? {}) as Record<string, number>;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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

      {/* Scores summary */}
      {Object.keys(scores).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {criteria.map((c: any) => {
            const score = scores[c.key];
            if (score == null) return null;
            return (
              <span key={c.key} className="text-xs bg-muted text-foreground/80 px-1.5 py-0.5 rounded" title={c.label}>
                {c.label?.split(" ")[0]}: {score}/{c.maxScore}
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
