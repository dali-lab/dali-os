import { useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/domain-lead.application.$id";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { ChevronDown } from "lucide-react";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "~/lib/domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";

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
  if (!auth.ok) return withAuth(auth, redirect("/login"));

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
    include: { domainLeadAssignments: true },
  });

  if (!member || member.domainLeadAssignments.length === 0) {
    return withAuth(auth, redirect("/reviewer"));
  }

  const leadDomainIds = member.domainLeadAssignments.map((a) => a.domainId);

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      ...domainApplicationStatusInclude,
      challengeVersion: { include: { domain: true, challenge: true } },
      application: {
        include: {
          user: true,
          statusUpdates: true,
          generalChallengeVersion: true,
          applicationCycle: {
            include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
          },
        },
      },
      reviews: {
        include: {
          cycleReviewer: {
            include: { daliMember: { select: { firstName: true, lastName: true } } },
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
                include: { daliMember: { select: { firstName: true, lastName: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!da) return withAuth(auth, redirect("/domain-lead"));
  if (!leadDomainIds.includes(da.challengeVersion.domainId!)) return withAuth(auth, redirect("/domain-lead"));

  // Load rubric criteria for score labels
  const dac = da.challengeVersion.domainId
    ? await prisma.domainApplicationCycle.findUnique({
        where: {
          domainId_applicationCycleId: {
            domainId: da.challengeVersion.domainId,
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

  return withAuth(auth, {
      domainApplication: da,
      application: da.application,
      inferredStatus,
      domainRubricCriteria: (dac?.rubricVersion?.criteria as any[]) ?? [],
      generalRubricCriteria: (generalRubric?.generalRubricVersion?.criteria as any[]) ?? [],
    });
}

export default function DomainLeadApplicationView() {
  const { domainApplication: da, application, inferredStatus, domainRubricCriteria, generalRubricCriteria } =
    useLoaderData<typeof loader>() as any;

  const generalQuestions: any[] = application.generalChallengeVersion?.questions ?? [];
  const challengeQuestions: any[] = da.challengeVersion.questions ?? [];
  const reviews: any[] = da.reviews ?? [];
  const decisions: any[] = da.decisions ?? [];
  const interview = da.interviews?.[0] ?? null;
  const statusInfo = STATUS_BADGE[inferredStatus] ?? STATUS_BADGE.Pending;
  const allCriteria = [...(generalRubricCriteria ?? []), ...(domainRubricCriteria ?? [])];

  return (
    <div className="space-y-4">
      <Link
        to="/domain-lead"
        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        ← Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {application.user.firstName} {application.user.lastName}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {da.challengeVersion.domain?.name} · {application.applicationCycle.name}
          </p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg}`}>
          {statusInfo.label}
        </span>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Application content */}
        <div className="lg:col-span-2 space-y-6">
          {generalQuestions.length > 0 && (
            <section className="bg-card border border-border rounded-lg p-6 space-y-5">
              <h2 className="text-lg font-semibold text-foreground">General Application</h2>
              {!isEmptyDoc(application.generalChallengeVersion?.description) && (
                <div className="border border-border rounded-md bg-muted/30 px-4 py-3">
                  <RichTextViewer content={application.generalChallengeVersion.description} />
                </div>
              )}
              {generalQuestions.map((q: any) => {
                const answer = application.answers?.[q.key];
                return (
                  <div key={q.key}>
                    <div className="text-sm font-medium text-foreground/80 mb-1">{q.data.label}</div>
                    <div className="text-sm text-foreground bg-muted/50 rounded p-3 whitespace-pre-wrap">
                      {answer || <span className="text-muted-foreground/70 italic">No answer provided</span>}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          <section className="bg-card border border-border rounded-lg p-6 space-y-5">
            <h2 className="text-lg font-semibold text-foreground">
              {da.challengeVersion.challenge?.name ?? `${da.challengeVersion.domain?.name} Challenge`}
            </h2>
            {!isEmptyDoc(da.challengeVersion.description) && (
              <div className="border border-border rounded-md bg-muted/30 px-4 py-3">
                <RichTextViewer content={da.challengeVersion.description} />
              </div>
            )}
            {challengeQuestions.map((q: any) => {
              const answer = da.answers?.[q.key];
              return (
                <div key={q.key}>
                  <div className="text-sm font-medium text-foreground/80 mb-1">{q.data.label}</div>
                  <div className="text-sm text-foreground bg-muted/50 rounded p-3 whitespace-pre-wrap">
                    {answer || <span className="text-muted-foreground/70 italic">No answer provided</span>}
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        {/* Right: Context sidebar */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Reviews */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-muted/50 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                Reviews ({reviews.filter((r: any) => r.submittedAt).length}/{reviews.length})
              </h3>
            </div>
            {reviews.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground/70">
                No reviewers assigned yet.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {reviews.map((review: any) => (
                  <ReviewCard key={review.id} review={review} criteria={allCriteria} />
                ))}
              </div>
            )}
          </div>

          {/* Interview */}
          {interview && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-muted/50 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Interview</h3>
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
                      const m = a.cycleInterviewer?.daliMember;
                      return m ? `${m.firstName} ${m.lastName}` : "?";
                    }).join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Decision history */}
          {decisions.length > 0 && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-muted/50 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Decision History</h3>
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
  const reviewer = review.cycleReviewer?.daliMember;
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
          className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          {expanded ? "Hide" : "Show"} feedback
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
      {expanded && (
        <div className="mt-2 space-y-2">
          {review.feedback && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">{review.feedback}</p>
          )}
          {review.rejectionRationale && (
            <p className="text-xs text-red-600 bg-red-50 rounded p-2">
              <span className="font-medium">Rejection rationale:</span> {review.rejectionRationale}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
