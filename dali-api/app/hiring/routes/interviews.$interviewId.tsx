import React, { useState, useCallback } from 'react'
import { useLoaderData } from 'react-router'
import { redirect } from 'react-router'
import {
  Clock,
  Check,
  Video,
  FileText,
  MapPin,
  MessageSquare,
  Users,
} from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from '~/lib/cookies'
import { getPresenceUser } from '~/lib/presence-user'
import { requirePageSignedOrRedirect } from '~/hiring/lib/confidentiality'
import { presignAnswers } from '~/hiring/lib/presign'
import { CollaborativeEditor } from '~/components/CollaborativeEditor'
import { PresenceProvider } from '~/components/collab/PresenceProvider'
import { PresenceBar } from '~/components/collab/PresenceBar'
import { useSharedString } from '~/components/collab/useSharedString'
import { ApplicationViewer } from '~/hiring/components/ApplicationViewer'
import { ReviewSummary } from '~/hiring/components/ReviewSummary'
import { PageHeader } from '~/hiring/components/PageHeader'
import { Section } from '~/hiring/components/Section'
import { DetailCard } from '~/hiring/components/DetailCard'
import { StatusStepper } from '~/hiring/components/StatusStepper'
import { InterviewStatusPill, RecommendationPill } from '~/hiring/components/Pill'
import { Button } from '~/components/ui/Button'
import { buildCriteriaLabelMap } from '~/hiring/lib/rubric-criteria'
import type { Route } from './+types/interviews.$interviewId'
import type { Question, DomainApplicationStatus } from '~/types'

const RECOMMENDATION_OPTIONS = [
  'Strong Hire',
  'Hire',
  'Lean Hire',
  'Lean No Hire',
  'No Hire',
]

const ROLE_LABELS: Record<string, string> = {
  InDomain: 'In-domain',
  CrossDomain: 'Cross-domain',
}

export const meta: Route.MetaFunction = ({ data }) => {
  const user = (data as any)?.interview?.domainApplication?.application?.user
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  return [{ title: `${name ? `${name} interview` : 'Interview'} · DALI OS` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) throw redirect('/login')

  const member = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { id: true, firstName: true, lastName: true, daliMember: { select: { id: true } } },
  })
  if (!member?.daliMember) throw redirect('/hiring/reviewer')

  const interview = await prisma.interview.findUnique({
    where: { id: params.interviewId },
    include: {
      assignments: {
        include: {
          cycleInterviewer: {
            include: { user: true },
          },
        },
      },
      domainApplication: {
        include: {
          application: {
            include: {
              user: true,
              generalChallengeVersion: true,
            },
          },
          challengeVersion: { include: { domain: true } },
          reviews: {
            where: { submittedAt: { not: null } },
            orderBy: { submittedAt: 'asc' },
            include: {
              cycleReviewer: { include: { user: true } },
            },
          },
        },
      },
    },
  })

  if (!interview) throw redirect('/hiring/reviewer')

  const myAssignment = interview.assignments.find(
    (a: any) => a.cycleInterviewer.userId === auth.user.sub,
  )

  if (!myAssignment) throw redirect('/hiring/reviewer')

  const confRedirect = await requirePageSignedOrRedirect(
    auth.user.sub,
    interview.applicationCycleId,
    request,
  )
  if (confRedirect) throw confRedirect

  // Rubric criteria for the applicant's domain. Interviews only exist on
  // Standard cycles where challengeVersion is always set; the optional chain
  // is just to satisfy TS now that the column is nullable.
  const domainId = interview.domainApplication.challengeVersion?.domainId ?? null
  let domainRubricVersionId: string | null = null
  if (domainId) {
    const domainAppCycle = await prisma.domainApplicationCycle.findUnique({
      where: {
        domainId_applicationCycleId: {
          domainId,
          applicationCycleId: interview.applicationCycleId,
        },
      },
      select: { rubricVersionId: true },
    })
    domainRubricVersionId = domainAppCycle?.rubricVersionId ?? null
  }
  // Criterion key -> label map for the submitted reviews' scores. Resilient to
  // rubric edits: prefers the current domain rubric but falls back to the
  // versions pinned on each review (and their history) so keys from older
  // rubric versions still resolve instead of leaking as raw crit-<ts> keys.
  const criteriaByKey = await buildCriteriaLabelMap({
    domainRubricVersionId,
    pinnedVersionIds: interview.domainApplication.reviews.map(
      (r: any) => r.rubricVersionId,
    ),
  })

  const collabToken = parseSessionCookie(request)

  // Presign file-type answers so interviewers can download uploads instead of
  // staring at raw S3 keys.
  const generalQuestions =
    (interview.domainApplication.application.generalChallengeVersion?.questions as unknown as Question[]) ?? []
  const challengeQuestions =
    (interview.domainApplication.challengeVersion?.questions as unknown as Question[]) ?? []
  const presignedGeneralAnswers = await presignAnswers(
    generalQuestions,
    interview.domainApplication.application.answers as Record<string, string>,
  )
  const presignedChallengeAnswers = await presignAnswers(
    challengeQuestions,
    interview.domainApplication.answers as Record<string, string>,
  )
  const interviewWithPresignedAnswers = {
    ...interview,
    domainApplication: {
      ...interview.domainApplication,
      answers: presignedChallengeAnswers,
      application: {
        ...interview.domainApplication.application,
        answers: presignedGeneralAnswers,
      },
    },
  }

  // Build user display name for cursors
  const fallbackName = [member.firstName, member.lastName].filter(Boolean).join(' ') || auth.user.email
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName)
  const userName = presenceUser?.name ?? fallbackName

  return {
      interview: interviewWithPresignedAnswers,
      myAssignment,
      criteriaByKey,
      collabToken,
      userName,
      currentUserId: auth.user.sub,
      presencePhotoUrl: presenceUser?.photoUrl ?? null,
      presenceSubtitle: presenceUser?.subtitle ?? null,
    }
}

export const handle = {
  breadcrumb: (data: unknown) => {
    const user = (
      data as
        | { interview?: { domainApplication?: { application?: { user?: { firstName?: string; lastName?: string } } } } }
        | undefined
    )?.interview?.domainApplication?.application?.user
    return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || undefined
  },
}

export default function InterviewDetailPage() {
  const {
    interview,
    myAssignment,
    criteriaByKey,
    collabToken,
    userName,
    currentUserId,
    presencePhotoUrl,
    presenceSubtitle,
  } = useLoaderData<typeof loader>() as any

  const applicant = interview.domainApplication?.application?.user
  const domain = interview.domainApplication?.challengeVersion?.domain?.name
  const startDate = new Date(interview.startTime)
  const endDate = new Date(interview.endTime)

  // Co-interviewers: active assignments other than the viewer's own. Declined
  // and Replaced assignments are hidden so a withdrawn interviewer doesn't show.
  const coInterviewers = (interview.assignments ?? [])
    .filter((a: any) => a.status === 'Active' && a.id !== myAssignment?.id)
    .map((a: any) => {
      const u = a.cycleInterviewer?.user
      const name =
        u?.firstName && u?.lastName
          ? `${u.firstName} ${u.lastName}`
          : u?.daliEmail ?? 'Interviewer'
      return { id: a.id, name, roleLabel: ROLE_LABELS[a.role] ?? a.role }
    })

  const application = interview.domainApplication?.application
  const generalQuestions: any[] =
    application?.generalChallengeVersion?.questions ?? []
  const domainQuestions: any[] =
    interview.domainApplication?.challengeVersion?.questions ?? []
  const submittedReviews: any[] = interview.domainApplication?.reviews ?? []

  const questionLabels: Record<string, string> = {}
  for (const q of [...generalQuestions, ...domainQuestions]) {
    if (q?.key) questionLabels[q.key] = q.data?.label ?? q.key
  }
  const viewerApplication = {
    answers: application?.answers ?? {},
    generalChallengeVersion: application?.generalChallengeVersion
      ? {
          questions: application.generalChallengeVersion.questions ?? [],
          description: application.generalChallengeVersion.description,
        }
      : null,
    domainApplications: [
      {
        id: interview.domainApplication?.id,
        answers: interview.domainApplication?.answers ?? {},
        challengeVersion: interview.domainApplication?.challengeVersion
          ? {
              questions: interview.domainApplication.challengeVersion.questions ?? [],
              description: interview.domainApplication.challengeVersion.description,
              domain: interview.domainApplication.challengeVersion.domain ?? { name: 'Domain' },
            }
          : null,
        domain: null,
      },
    ],
  }

  // Recommendation dropdown — synced live between interviewers via a Y.Map
  // on a dedicated collab doc. Hocuspocus persists it, so the draft survives
  // refresh; on Mark Complete the value is also written to interview.recommendation.
  const {
    value: recommendation,
    setValue: setRecommendation,
  } = useSharedString(
    `interview:${interview.id}:rec-vote`,
    collabToken,
    interview.recommendation ?? '',
  )

  // Completed state — also shared live so that when one interviewer marks the
  // joint recommendation complete, the co-interviewer's open page flips to the
  // Completed view immediately (rather than only after a manual reload). The
  // DB write is still the source of truth on next load; this flag mirrors it
  // for the live session. Seeded from interview.status.
  const {
    value: completedFlag,
    setValue: setCompletedFlag,
  } = useSharedString(
    `interview:${interview.id}:rec-status`,
    collabToken,
    interview.status === 'Completed' ? 'completed' : '',
  )
  const isCompleted = completedFlag === 'completed'
  const setIsCompleted = (next: boolean) =>
    setCompletedFlag(next ? 'completed' : '')
  const [completing, setCompleting] = useState(false)

  // Mark complete
  const handleMarkComplete = useCallback(async () => {
    if (!recommendation) return
    setCompleting(true)
    try {
      const res = await fetch(`/api/hiring/interviews/${interview.id}/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation }),
      })
      // 409 = the co-interviewer already submitted this joint recommendation.
      // That's the success case here, not an error: flip to Completed anyway.
      if (res.ok || res.status === 409) {
        setIsCompleted(true)
      }
    } finally {
      setCompleting(false)
    }
  }, [interview.id, recommendation])

  // Reopen interview
  const handleReopen = useCallback(async () => {
    setCompleting(true)
    try {
      const res = await fetch(`/api/hiring/interviews/${interview.id}/complete`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setIsCompleted(false)
      }
    } finally {
      setCompleting(false)
    }
  }, [interview.id])

  const displayStatus = isCompleted ? 'Completed' : interview.status
  // The interview surface always sits on the Interview stage of the funnel; once
  // it's completed the application moves to post-interview review. Both land on
  // the same stepper node, so this mirrors real backend state without inventing
  // any — it's just how far this application has travelled.
  const pipelineStatus: DomainApplicationStatus = isCompleted
    ? 'PostInterviewPending'
    : 'InterviewScheduled'

  const locationLabel =
    interview.location === 'PodAppa'
      ? 'Pod Appa'
      : interview.location === 'PodMomo'
        ? 'Pod Momo'
        : interview.location === 'Online'
          ? 'Online'
          : null

  return (
    <PresenceProvider
      pageId={`interview:${interview.id}`}
      token={collabToken}
      userName={userName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        back={{ label: 'Back to interviews', to: '/hiring/interviews' }}
        title={applicant ? `${applicant.firstName} ${applicant.lastName}` : 'Applicant'}
        subtitle={domain ? `${domain} interview` : 'Interview'}
        chip={<InterviewStatusPill status={displayStatus} />}
        actions={<PresenceBar />}
      />

      {/* Logistics + pipeline position */}
      <DetailCard title="Interview details">
        <div className="px-6 py-5 space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-muted-foreground" aria-hidden />
              {startDate.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}{' '}
              {startDate.toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}{' '}
              -{' '}
              {endDate.toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            {locationLabel && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-muted-foreground" aria-hidden />
                {locationLabel}
              </span>
            )}
            {interview.location === 'Online' && interview.zoomJoinUrl && (
              <a
                href={interview.zoomJoinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-accent-coral hover:underline"
              >
                <Video className="w-4 h-4" aria-hidden />
                Join Zoom call
              </a>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-4 h-4 text-muted-foreground" aria-hidden />
              {coInterviewers.length > 0
                ? `With ${coInterviewers
                    .map(
                      (c: { name: string; roleLabel: string }) =>
                        `${c.name} (${c.roleLabel})`,
                    )
                    .join(', ')}`
                : 'No co-interviewer assigned'}
            </span>
          </div>
          <StatusStepper
            status={pipelineStatus}
            variant="compact"
            className="max-w-md"
          />
        </div>
      </DetailCard>

      {/* Prep note from deliberations (read-only) */}
      {interview.domainApplication?.interviewPrepNote?.trim() && (
        <div className="bg-brand-tint rounded-xl border border-border p-6">
          <h2 className="font-heading text-sm font-semibold text-foreground mb-2">
            From deliberations — bring this up in the interview
          </h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {interview.domainApplication.interviewPrepNote}
          </p>
        </div>
      )}

      {/* Application (collapsible) */}
      <Section
        title="Application"
        icon={<FileText className="w-4 h-4 text-muted-foreground" />}
        defaultOpen={false}
      >
        <ApplicationViewer
          application={viewerApplication}
          questionLabels={questionLabels}
          readOnly
        />
      </Section>

      {/* Reviewer notes (collapsible) */}
      <Section
        title="Reviewer notes"
        icon={<MessageSquare className="w-4 h-4 text-muted-foreground" />}
        badge={
          <span className="text-xs font-medium text-muted-foreground">
            {submittedReviews.length}
          </span>
        }
        defaultOpen={false}
      >
        {submittedReviews.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No submitted reviews for this applicant yet.
          </p>
        ) : (
          <div className="space-y-6">
            {submittedReviews.map((review: any) => {
              const m = review.cycleReviewer?.user
              const reviewerName =
                m?.firstName && m?.lastName
                  ? `${m.firstName} ${m.lastName}`
                  : m?.daliEmail ?? 'Reviewer'
              return (
                <div
                  key={review.id}
                  className="border border-border rounded-lg p-4"
                >
                  <ReviewSummary
                    reviewerName={reviewerName}
                    submittedAt={review.submittedAt}
                    overallRecommendation={review.overallRecommendation}
                    scores={review.scores}
                    criteria={criteriaByKey}
                    feedback={review.feedback}
                    rejectionRationale={review.rejectionRationale}
                  />
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* Joint interview notes — collaborative editor */}
      <DetailCard
        title="Interview notes"
        subtitle="Shared in real time — both interviewers edit the same document."
      >
        <div className="p-6">
          {collabToken ? (
            <CollaborativeEditor
              editorId="notes"
              documentName={`interview:${interview.id}:notes`}
              token={collabToken}
              userName={userName}
              disabled={isCompleted}
              placeholder="Write your interview notes here…"
            />
          ) : (
            <div className="p-4 bg-accent-yellow/10 rounded-lg border border-accent-yellow/40 text-sm text-foreground">
              Your session expired. Refresh the page to keep editing these notes together.
            </div>
          )}
        </div>
      </DetailCard>

      {/* Joint recommendation */}
      <DetailCard
        title="Joint recommendation"
        subtitle="One shared recommendation for this interview — either interviewer submits it on behalf of both."
      >
        <div className="p-6">
          {isCompleted ? (
            <div className="rounded-lg border border-border bg-brand-tint p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <span className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
                  <Check className="w-5 h-5 text-accent-teal" aria-hidden />
                  Interview completed
                </span>
                <button
                  onClick={handleReopen}
                  disabled={completing}
                  className="text-xs font-medium text-accent-coral hover:underline disabled:text-muted-foreground disabled:no-underline"
                >
                  {completing ? 'Reopening…' : 'Reopen interview'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <span className="text-muted-foreground">Recommendation:</span>
                {(interview.recommendation ?? recommendation) ? (
                  <RecommendationPill value={interview.recommendation ?? recommendation} />
                ) : (
                  <span className="text-muted-foreground">Not recorded</span>
                )}
              </div>
              {interview.recommendationNotes && (
                <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">
                  {interview.recommendationNotes}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="recommendation"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  Recommendation
                </label>
                <select
                  id="recommendation"
                  value={recommendation}
                  onChange={(e) => setRecommendation(e.target.value)}
                  className="w-full sm:w-64 px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/30 focus-visible:ring-offset-2"
                >
                  <option value="">Select a recommendation…</option>
                  {RECOMMENDATION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                onClick={handleMarkComplete}
                disabled={!recommendation || completing}
                variant="primary"
              >
                <Check className="w-4 h-4" aria-hidden />
                {completing ? 'Completing interview…' : 'Complete interview'}
              </Button>
            </div>
          )}
        </div>
      </DetailCard>
    </div>
    </PresenceProvider>
  )
}
