import React, { useState, useCallback } from 'react'
import { Link, useLoaderData } from 'react-router'
import { redirect } from 'react-router'
import {
  ArrowLeft,
  Clock,
  Check,
  Video,
  AlertTriangle,
  ChevronDown,
  FileText,
  MapPin,
  MessageSquare,
} from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from '~/lib/cookies'
import { requirePageSignedOrRedirect } from '~/hiring/lib/confidentiality'
import { presignAnswers } from '~/hiring/lib/presign'
import { CollaborativeEditor } from '~/components/CollaborativeEditor'
import { PresenceProvider } from '~/components/collab/PresenceProvider'
import { PresenceBar } from '~/components/collab/PresenceBar'
import { useSharedString } from '~/components/collab/useSharedString'
import { RichTextViewer, isEmptyDoc } from '~/components/RichTextViewer'
import { AnswerDisplay } from '~/hiring/components/ApplicationAnswers'
import type { Route } from './+types/interviewer.interview.$interviewId'
import type { Question } from '~/types'

const RECOMMENDATION_OPTIONS = [
  'Strong Hire',
  'Hire',
  'Lean Hire',
  'Lean No Hire',
  'No Hire',
]

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'bg-blue-100 text-blue-700',
  Completed: 'bg-green-100 text-green-700',
  CancelledByApplicant: 'bg-red-100 text-red-700',
  CancelledByAdmin: 'bg-muted text-foreground/80',
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
  let rubricCriteria: any[] = []
  if (domainId) {
    const domainAppCycle = await prisma.domainApplicationCycle.findUnique({
      where: {
        domainId_applicationCycleId: {
          domainId,
          applicationCycleId: interview.applicationCycleId,
        },
      },
    })
    if (domainAppCycle?.rubricVersionId) {
      const rv = await prisma.rubricVersion.findUnique({
        where: { id: domainAppCycle.rubricVersionId },
      })
      rubricCriteria = (rv?.criteria as any[] | null) ?? []
    }
  }

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
  const userName = [member.firstName, member.lastName].filter(Boolean).join(' ') || auth.user.email

  return {
      interview: interviewWithPresignedAnswers,
      myAssignment,
      rubricCriteria,
      collabToken,
      userName,
    }
}

export default function InterviewDetailPage() {
  const { interview, myAssignment, rubricCriteria, collabToken, userName } =
    useLoaderData<typeof loader>() as any

  const applicant = interview.domainApplication?.application?.user
  const domain = interview.domainApplication?.challengeVersion?.domain?.name
  const startDate = new Date(interview.startTime)
  const endDate = new Date(interview.endTime)

  // Collapsible panel state
  const [showApplication, setShowApplication] = useState(false)
  const [showReviews, setShowReviews] = useState(false)

  const application = interview.domainApplication?.application
  const generalQuestions: any[] =
    application?.generalChallengeVersion?.questions ?? []
  const domainQuestions: any[] =
    interview.domainApplication?.challengeVersion?.questions ?? []
  const submittedReviews: any[] = interview.domainApplication?.reviews ?? []
  const criteriaByKey: Record<string, { label: string }> = {}
  for (const c of rubricCriteria as any[]) {
    if (c?.key) criteriaByKey[c.key] = { label: c.label ?? c.key }
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

  // Completed state
  const [isCompleted, setIsCompleted] = useState(
    interview.status === 'Completed',
  )
  const [completing, setCompleting] = useState(false)

  // Decline state
  const [declining, setDeclining] = useState(false)

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
      if (res.ok) {
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

  // Mark unavailable (decline)
  const handleDecline = useCallback(async () => {
    if (
      !confirm(
        'Are you sure you want to mark yourself as unavailable for this interview?',
      )
    )
      return
    setDeclining(true)
    try {
      const res = await fetch(
        `/api/hiring/cycles/${interview.applicationCycleId}/my-interviews/${interview.id}/decline`,
        {
          method: 'POST',
          credentials: 'include',
        },
      )
      if (res.ok) {
        window.location.href = '/hiring/reviewer'
        return
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        alert(
          body.error ??
            'No replacement interviewer is available. Please contact the hiring lead.',
        )
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      alert(`Failed to mark unavailable: ${body.error ?? res.statusText}`)
    } catch (e) {
      alert(
        `Failed to mark unavailable: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    } finally {
      setDeclining(false)
    }
  }, [interview.id, interview.applicationCycleId])

  return (
    <PresenceProvider
      pageId={`interview:${interview.id}`}
      token={collabToken}
      userName={userName}
    >
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Back button + presence avatars inline */}
      <div className="flex items-center justify-between">
        <Link
          to="/hiring/reviewer"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground/80"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Dashboard
        </Link>
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
                    : STATUS_COLORS[interview.status] ??
                      'bg-muted text-foreground/80'
                }`}
              >
                {isCompleted ? 'Completed' : interview.status}
              </span>
            </div>
          </div>
          {!isCompleted && (
            <button
              onClick={handleDecline}
              disabled={declining}
              className="inline-flex items-center px-3 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
            >
              <AlertTriangle className="w-4 h-4 mr-1.5" />
              {declining ? 'Declining...' : 'Mark Unavailable'}
            </button>
          )}
        </div>
      </div>

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
          <div className="px-6 pb-6 space-y-6 border-t border-border pt-6">
            {generalQuestions.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
                  General Application
                </h3>
                {!isEmptyDoc(application?.generalChallengeVersion?.description) && (
                  <div className="border border-border rounded-md bg-muted/30 px-4 py-3">
                    <RichTextViewer content={application.generalChallengeVersion.description} />
                  </div>
                )}
                {generalQuestions.map((q: any) => (
                  <div key={q.key}>
                    <div className="text-sm font-medium text-foreground/80 mb-1">
                      {q.data?.label ?? q.key}
                    </div>
                    <div className="text-sm text-foreground bg-muted/50 rounded p-3">
                      <AnswerDisplay question={q} answer={application?.answers?.[q.key] ?? ''} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {domainQuestions.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
                  {domain} Challenge
                </h3>
                {!isEmptyDoc(interview.domainApplication?.challengeVersion?.description) && (
                  <div className="border border-border rounded-md bg-muted/30 px-4 py-3">
                    <RichTextViewer content={interview.domainApplication.challengeVersion.description} />
                  </div>
                )}
                {domainQuestions.map((q: any) => (
                  <div key={q.key}>
                    <div className="text-sm font-medium text-foreground/80 mb-1">
                      {q.data?.label ?? q.key}
                    </div>
                    <div className="text-sm text-foreground bg-muted/50 rounded p-3">
                      <AnswerDisplay question={q} answer={interview.domainApplication?.answers?.[q.key] ?? ''} />
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                  const scoreEntries = Object.entries(
                    (review.scores as Record<string, number>) ?? {},
                  )
                  return (
                    <div
                      key={review.id}
                      className="border border-border rounded-lg p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-foreground">
                            {reviewerName}
                          </div>
                          {review.submittedAt && (
                            <div className="text-xs text-muted-foreground">
                              Submitted{' '}
                              {new Date(
                                review.submittedAt,
                              ).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </div>
                          )}
                        </div>
                        {review.overallRecommendation && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            {review.overallRecommendation}
                          </span>
                        )}
                      </div>
                      {scoreEntries.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {scoreEntries.map(([key, score]) => (
                            <div
                              key={key}
                              className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1"
                            >
                              <span className="text-muted-foreground">
                                {criteriaByKey[key]?.label ?? key}
                              </span>
                              <span className="font-semibold text-foreground">
                                {score}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {review.feedback && (
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                            Feedback
                          </div>
                          <p className="text-sm text-foreground/80 whitespace-pre-wrap bg-muted/50 rounded p-3">
                            {review.feedback}
                          </p>
                        </div>
                      )}
                      {review.rejectionRationale && (
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                            Rejection rationale
                          </div>
                          <p className="text-sm text-foreground/80 whitespace-pre-wrap bg-muted/50 rounded p-3">
                            {review.rejectionRationale}
                          </p>
                        </div>
                      )}
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
          <CollaborativeEditor
            editorId="notes"
            documentName={`interview:${interview.id}:notes`}
            token={collabToken}
            userName={userName}
            disabled={isCompleted}
            placeholder="Write your interview notes here..."
          />
        ) : (
          <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200 text-sm text-yellow-800">
            Session expired — please refresh to enable collaborative editing.
          </div>
        )}
      </div>

      {/* Joint Recommendation */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Joint Recommendation
        </h2>

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
              <select
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
                className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a recommendation...</option>
                {RECOMMENDATION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Your Notes
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Private — only you can see these notes. Autosaved.
              </p>
              {collabToken ? (
                <CollaborativeEditor
                  editorId="recommendation"
                  documentName={`interview:${interview.id}:rec-notes-${myAssignment.id}`}
                  token={collabToken}
                  userName={userName}
                  placeholder="Your notes on the recommendation..."
                />
              ) : (
                <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200 text-sm text-yellow-800">
                  Session expired — please refresh.
                </div>
              )}
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
