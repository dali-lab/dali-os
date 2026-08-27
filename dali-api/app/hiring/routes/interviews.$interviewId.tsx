import React, { useState, useCallback } from 'react'
import { useLoaderData } from 'react-router'
import { redirect } from 'react-router'
import {
  Clock,
  Check,
  Video,
  ChevronDown,
  FileText,
  MapPin,
  MessageSquare,
  Users,
} from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from '~/lib/login-next'
import { resolvePhotoUrl } from '~/lib/photo'
import { parseSessionCookie } from '~/lib/cookies'
import { getPresenceUser } from '~/lib/presence-user'
import { requirePageSignedOrRedirect } from '~/hiring/lib/confidentiality'
import { presignAnswers } from '~/hiring/lib/presign'
import { ensureBlocks } from '~/collab/legacy/pm-to-blocknote'
import { safeParseJsonString } from '~/forms/lib/forms-data'
import { DocEditor } from '~/components/doc'
import { PresenceProvider } from '~/components/collab/PresenceProvider'
import { PresenceBar } from '~/components/collab/PresenceBar'
import { useSharedString } from '~/components/collab/useSharedString'
import { ApplicationViewer } from '~/hiring/components/ApplicationViewer'
import { ReviewSummary } from '~/hiring/components/ReviewSummary'
import { buildCriteriaLabelMap } from '~/hiring/lib/rubric-criteria'
import type { Route } from './+types/interviews.$interviewId'
import type { Question } from '~/types'
import { INTERVIEW_STATUS_COLORS } from '~/hiring/lib/labels'
import { Select, type SelectOption } from "~/components/ui/floating";

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
  if (!auth.ok) throw redirectToLogin(request)

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
              applicationFormVersion: { select: { questions: true, intro: true } },
            },
          },
          challengeFormVersion: { select: { questions: true, intro: true } },
          domain: true,
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

  // Rubric criteria for the applicant's domain. DomainApplication.domainId is
  // always set for Standard cycles (the only cycleType that schedules interviews).
  const domainId = interview.domainApplication.domainId ?? null
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
    (interview.domainApplication.application.applicationFormVersion?.questions as unknown as Question[]) ?? []
  const challengeQuestions =
    (interview.domainApplication.challengeFormVersion?.questions as unknown as Question[]) ?? []
  const presignedGeneralAnswers = await presignAnswers(
    generalQuestions,
    interview.domainApplication.application.answers as Record<string, string>,
  )
  const presignedChallengeAnswers = await presignAnswers(
    challengeQuestions,
    interview.domainApplication.answers as Record<string, string>,
  )
  // Resolve each reviewer's avatar to a ready src (raw photoUrl is an S3 key).
  const reviewsWithPhotos = await Promise.all(
    interview.domainApplication.reviews.map(async (r: any) => ({
      ...r,
      reviewerPhotoUrl: await resolvePhotoUrl(r.cycleReviewer?.user?.photoUrl),
    })),
  )
  // FormVersion.intro is stored as a JSON string; ensureBlocks converts it to
  // block JSON for ApplicationViewer. Descriptions come from intro now that
  // ChallengeVersion is gone.
  const interviewWithPresignedAnswers = {
    ...interview,
    domainApplication: {
      ...interview.domainApplication,
      challengeFormVersion: interview.domainApplication.challengeFormVersion
        ? {
            ...interview.domainApplication.challengeFormVersion,
            description: ensureBlocks(safeParseJsonString(interview.domainApplication.challengeFormVersion.intro)),
          }
        : interview.domainApplication.challengeFormVersion,
      answers: presignedChallengeAnswers,
      reviews: reviewsWithPhotos,
      application: {
        ...interview.domainApplication.application,
        answers: presignedGeneralAnswers,
        applicationFormVersion: interview.domainApplication.application.applicationFormVersion
          ? {
              ...interview.domainApplication.application.applicationFormVersion,
              description: ensureBlocks(
                safeParseJsonString(interview.domainApplication.application.applicationFormVersion.intro),
              ),
            }
          : interview.domainApplication.application.applicationFormVersion,
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
  const domain = interview.domainApplication?.domain?.name
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

  // Collapsible panel state
  const [showApplication, setShowApplication] = useState(false)
  const [showReviews, setShowReviews] = useState(false)

  const application = interview.domainApplication?.application
  const generalQuestions: any[] =
    application?.applicationFormVersion?.questions ?? []
  const domainQuestions: any[] =
    interview.domainApplication?.challengeFormVersion?.questions ?? []
  const submittedReviews: any[] = interview.domainApplication?.reviews ?? []

  const questionLabels: Record<string, string> = {}
  for (const q of [...generalQuestions, ...domainQuestions]) {
    if (q?.key) questionLabels[q.key] = q.data?.label ?? q.key
  }
  const viewerApplication = {
    answers: application?.answers ?? {},
    // ApplicationViewer renders `generalChallengeVersion`/`challengeVersion`
    // {questions, description}; synthesize those shapes from the bound Forms.
    generalChallengeVersion: application?.applicationFormVersion
      ? {
          questions: application.applicationFormVersion.questions ?? [],
          description: application.applicationFormVersion.description,
        }
      : null,
    domainApplications: [
      {
        id: interview.domainApplication?.id,
        answers: interview.domainApplication?.answers ?? {},
        challengeVersion: interview.domainApplication?.challengeFormVersion
          ? {
              questions: interview.domainApplication.challengeFormVersion.questions ?? [],
              description: interview.domainApplication.challengeFormVersion.description,
            }
          : null,
        domain: interview.domainApplication?.domain ?? null,
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

  return (
    <PresenceProvider
      pageId={`interview:${interview.id}`}
      token={collabToken}
      userName={userName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-end">
        <PresenceBar />
      </div>

      {/* Header */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center">
              <Video className="w-5 h-5 mr-2 text-blue-600" />
              Interview:{' '}
              {applicant
                ? `${applicant.firstName} ${applicant.lastName}`
                : 'Applicant'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center">
                <Clock className="w-4 h-4 mr-1 text-muted-foreground/70" />
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
              {domain && (
                <span className="px-2 py-0.5 bg-muted text-foreground/80 rounded text-xs font-medium">
                  {domain}
                </span>
              )}
              {interview.location && (
                <span className="flex items-center">
                  <MapPin className="w-4 h-4 mr-1 text-muted-foreground/70" />
                  {interview.location === 'PodAppa'
                    ? 'Pod Appa'
                    : interview.location === 'PodMomo'
                      ? 'Pod Momo'
                      : 'Online'}
                </span>
              )}
              {interview.location === 'Online' && interview.zoomJoinUrl && (
                <a href={interview.zoomJoinUrl} target="_blank" rel="noopener noreferrer"
                   className="flex items-center text-sm text-blue-600 hover:underline">
                  <Video className="w-4 h-4 mr-1" />
                  Join Zoom
                </a>
              )}
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  isCompleted
                    ? 'bg-green-100 text-green-700'
                    : INTERVIEW_STATUS_COLORS[interview.status] ??
                      'bg-muted text-foreground/80'
                }`}
              >
                {isCompleted ? 'Completed' : interview.status}
              </span>
              <span className="flex items-center">
                <Users className="w-4 h-4 mr-1 text-muted-foreground/70" />
                {coInterviewers.length > 0 ? (
                  <>
                    with{' '}
                    {coInterviewers
                      .map(
                        (c: { name: string; roleLabel: string }) =>
                          `${c.name} (${c.roleLabel})`,
                      )
                      .join(', ')}
                  </>
                ) : (
                  'No co-interviewer assigned'
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Prep note from deliberations (read-only) */}
      {interview.domainApplication?.interviewPrepNote?.trim() && (
        <div className="bg-blue-50 rounded-xl border border-blue-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wide mb-2">
            From deliberations — to bring up in the interview
          </h2>
          <p className="text-sm text-blue-900 whitespace-pre-wrap">
            {interview.domainApplication.interviewPrepNote}
          </p>
        </div>
      )}

      {/* Application (collapsible) */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <button
          onClick={() => setShowApplication(!showApplication)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/50 rounded-xl"
        >
          <span className="flex items-center text-lg font-semibold text-foreground">
            <FileText className="w-5 h-5 mr-2 text-blue-600" />
            Application
          </span>
          <ChevronDown
            className={`w-5 h-5 text-muted-foreground/70 transition-transform ${
              showApplication ? 'rotate-180' : ''
            }`}
          />
        </button>
        {showApplication && (
          <div className="px-6 pb-6 border-t border-border pt-6">
            <ApplicationViewer
              application={viewerApplication as any}
              questionLabels={questionLabels}
              readOnly
            />
          </div>
        )}
      </div>

      {/* Reviewer Notes (collapsible) */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <button
          onClick={() => setShowReviews(!showReviews)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/50 rounded-xl"
        >
          <span className="flex items-center text-lg font-semibold text-foreground">
            <MessageSquare className="w-5 h-5 mr-2 text-blue-600" />
            Reviewer Notes ({submittedReviews.length})
          </span>
          <ChevronDown
            className={`w-5 h-5 text-muted-foreground/70 transition-transform ${
              showReviews ? 'rotate-180' : ''
            }`}
          />
        </button>
        {showReviews && (
          <div className="px-6 pb-6 border-t border-border pt-6">
            {submittedReviews.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No submitted reviews for this applicant.
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
                        reviewerPhotoUrl={review.reviewerPhotoUrl}
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
          </div>
        )}
      </div>

      {/* Joint Interview Notes — collaborative editor */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Interview Notes
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Shared notes — both interviewers edit this document in real-time.
        </p>
        {collabToken ? (
          <DocEditor
            features="notes"
            editable={!isCompleted}
            placeholder="Write your interview notes here..."
            className={`rounded-lg border ${
              isCompleted
                ? 'border-border bg-muted/50 opacity-75'
                : 'border-gray-300 bg-card focus-within:ring-2 focus-within:ring-accent-coral focus-within:border-transparent'
            }`}
            collab={{
              documentName: `interview:${interview.id}:notes`,
              token: collabToken,
              userName,
              userId: currentUserId,
            }}
          />
        ) : (
          <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200 text-sm text-yellow-800">
            Session expired — please refresh to enable collaborative editing.
          </div>
        )}
      </div>

      {/* Joint Recommendation */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Joint Recommendation
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          One shared recommendation for this interview. Either interviewer
          submits it on behalf of both — only one of you needs to mark it
          complete.
        </p>

        {isCompleted ? (
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center">
                <Check className="w-5 h-5 text-green-600 mr-2" />
                <span className="font-medium text-green-800">
                  Interview Completed
                </span>
              </div>
              <button
                onClick={handleReopen}
                disabled={completing}
                className="text-xs font-medium text-green-700 hover:text-green-900 underline disabled:text-muted-foreground/70 disabled:no-underline"
              >
                {completing ? 'Reopening…' : 'Reopen'}
              </button>
            </div>
            <p className="text-sm text-green-700">
              <strong>Recommendation:</strong>{' '}
              {interview.recommendation ?? recommendation}
            </p>
            {interview.recommendationNotes && (
              <p className="text-sm text-green-700 mt-1">
                <strong>Notes:</strong> {interview.recommendationNotes}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Recommendation
              </label>
              <Select
                value={recommendation}
                placeholder="Select a recommendation..."
                onChange={(v) => setRecommendation(v)}
                options={RECOMMENDATION_OPTIONS.map((opt) => ({ value: opt, label: opt }))}
                buttonClassName="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleMarkComplete}
                disabled={!recommendation || completing}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <Check className="w-4 h-4 mr-1.5" />
                {completing ? 'Completing...' : 'Mark Complete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </PresenceProvider>
  )
}
