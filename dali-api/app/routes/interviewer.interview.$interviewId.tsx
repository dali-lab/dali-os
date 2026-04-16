import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useLoaderData } from 'react-router'
import { redirect } from 'react-router'
import {
  ArrowLeft,
  Save,
  Clock,
  Check,
  Video,
  AlertTriangle,
  ChevronDown,
  FileText,
  MessageSquare,
} from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import { SaveStatusIndicator } from '~/components/SaveStatusIndicator'
import type { Route } from './+types/interviewer.interview.$interviewId'

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
  CancelledByAdmin: 'bg-gray-100 text-gray-700',
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) throw redirect('/login')

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  })
  if (!member) throw redirect('/interviewer')

  const interview = await prisma.interview.findUnique({
    where: { id: params.interviewId },
    include: {
      assignments: {
        include: {
          cycleInterviewer: {
            include: { daliMember: true },
          },
          noteVersions: {
            orderBy: { createdAt: 'desc' },
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
              cycleReviewer: { include: { daliMember: true } },
            },
          },
        },
      },
    },
  })

  if (!interview) throw redirect('/interviewer')

  // Identify my assignment vs other assignment
  const myAssignment = interview.assignments.find(
    (a: any) => a.cycleInterviewer.daliMemberId === member.id,
  )
  const otherAssignment = interview.assignments.find(
    (a: any) => a.cycleInterviewer.daliMemberId !== member.id,
  )

  if (!myAssignment) throw redirect('/interviewer')

  // Rubric criteria for the applicant's domain — used to label review scores.
  // `ChallengeVersion.domainId` is nullable at the schema level (general form
  // has no domain), but a DomainApplication is always attached to a
  // domain-scoped challenge version, so we null-check defensively.
  const domainId = interview.domainApplication.challengeVersion.domainId
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

  return {
    interview,
    myAssignment,
    otherAssignment: otherAssignment ?? null,
    rubricCriteria,
  }
}

export default function InterviewDetailPage() {
  const { interview, myAssignment, otherAssignment, rubricCriteria } =
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

  // Notes state
  const [notes, setNotes] = useState(
    myAssignment.noteVersions?.[0]?.content ?? '',
  )
  const [savedContent, setSavedContent] = useState<string>(
    myAssignment.noteVersions?.[0]?.content ?? '',
  )
  const [lastSaved, setLastSaved] = useState<Date | null>(
    myAssignment.noteVersions?.[0]?.createdAt
      ? new Date(myAssignment.noteVersions[0].createdAt)
      : null,
  )
  const [savingInFlight, setSavingInFlight] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [myNoteVersions, setMyNoteVersions] = useState<any[]>(
    myAssignment.noteVersions ?? [],
  )
  // "Saving..." shows whenever there's dirty content OR a fetch is in flight.
  const isDirty = notes !== savedContent
  const showSaving = savingInFlight || isDirty

  // Recommendation state
  const [recommendation, setRecommendation] = useState<string>(
    interview.recommendation ?? '',
  )
  const [recommendationNotes, setRecommendationNotes] = useState<string>(
    interview.recommendationNotes ?? '',
  )
  const [savingRecommendation, setSavingRecommendation] = useState(false)

  // Completed state
  const [isCompleted, setIsCompleted] = useState(
    interview.status === 'Completed',
  )
  const [completing, setCompleting] = useState(false)

  // Decline state
  const [declining, setDeclining] = useState(false)

  // Auto-save: throttle to at most 1 save / sec while actively typing, plus
  // a trailing save 3s after the last keystroke to catch the final state.
  const notesRef = useRef(notes)
  notesRef.current = notes
  const savedContentRef = useRef<string>(
    myAssignment.noteVersions?.[0]?.content ?? '',
  )
  const lastSaveAtRef = useRef<number>(0)
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveNotes = useCallback(async () => {
    const content = notesRef.current
    // No-op if the server already has this content.
    if (content === savedContentRef.current) return
    setSavingInFlight(true)
    try {
      const res = await fetch(
        `/api/interview-assignments/${myAssignment.id}/notes`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      )
      if (res.ok) {
        const version = await res.json()
        savedContentRef.current = content
        lastSaveAtRef.current = Date.now()
        setSavedContent(content)
        setLastSaved(new Date())
        // Prepend the new version to the history list (server orders desc).
        setMyNoteVersions((prev) => [version, ...prev])
      }
    } finally {
      setSavingInFlight(false)
    }
  }, [myAssignment.id])

  useEffect(() => {
    if (notes === savedContentRef.current) return

    // Throttle leg: if it's been ≥1s since the last save, fire now.
    // Otherwise schedule the next throttled save at the 1s mark.
    const now = Date.now()
    const elapsed = now - lastSaveAtRef.current
    if (throttleTimer.current) clearTimeout(throttleTimer.current)
    if (elapsed >= 1000) {
      void saveNotes()
    } else {
      throttleTimer.current = setTimeout(() => {
        void saveNotes()
      }, 1000 - elapsed)
    }

    // Trailing leg: 3s after the last keystroke, make sure the final
    // content is saved.
    if (trailingTimer.current) clearTimeout(trailingTimer.current)
    trailingTimer.current = setTimeout(() => {
      void saveNotes()
    }, 3000)

    return () => {
      if (throttleTimer.current) clearTimeout(throttleTimer.current)
      if (trailingTimer.current) clearTimeout(trailingTimer.current)
    }
  }, [notes, saveNotes])

  const handleRestoreVersion = useCallback((content: string) => {
    // Just overwrite the textarea — the auto-save effect picks it up and
    // creates a new version as the server-side "current" note.
    setNotes(content)
    setShowHistory(false)
  }, [])

  // Save recommendation
  const handleSaveRecommendation = useCallback(async () => {
    setSavingRecommendation(true)
    try {
      await fetch(`/api/interviews/${interview.id}/complete`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation, recommendationNotes }),
      })
    } finally {
      setSavingRecommendation(false)
    }
  }, [interview.id, recommendation, recommendationNotes])

  // Mark complete
  const handleMarkComplete = useCallback(async () => {
    if (!recommendation) return
    setCompleting(true)
    try {
      const res = await fetch(`/api/interviews/${interview.id}/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation, recommendationNotes }),
      })
      if (res.ok) {
        setIsCompleted(true)
      }
    } finally {
      setCompleting(false)
    }
  }, [interview.id, recommendation, recommendationNotes])

  // Reopen (un-complete) interview — flips status back to Scheduled so notes
  // and the recommendation can be edited again.
  const handleReopen = useCallback(async () => {
    setCompleting(true)
    try {
      const res = await fetch(`/api/interviews/${interview.id}/complete`, {
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

  // Mark unavailable (decline). The backend is atomic: either it swaps a
  // replacement in (→ success, redirect to dashboard) or it fails with 409
  // because no replacement is available (→ toast, stay on page).
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
        `/api/cycles/${interview.applicationCycleId}/my-interviews/${interview.id}/decline`,
        {
          method: 'POST',
          credentials: 'include',
        },
      )
      if (res.ok) {
        window.location.href = '/interviewer'
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

  // Other interviewer's latest note — poll every 3s so edits by the other
  // interviewer show up live without a manual refresh.
  const [otherLatestNote, setOtherLatestNote] = useState<
    { id: string; content: string; createdAt: string } | null
  >(otherAssignment?.noteVersions?.[0] ?? null)

  useEffect(() => {
    if (!otherAssignment?.id) return
    let cancelled = false
    const fetchLatest = async () => {
      try {
        const res = await fetch(
          `/api/interview-assignments/${otherAssignment.id}/notes`,
          { credentials: 'include' },
        )
        if (!res.ok || cancelled) return
        const versions = await res.json()
        if (cancelled) return
        setOtherLatestNote(versions?.[0] ?? null)
      } catch {
        // swallow — transient network errors shouldn't break the UI
      }
    }
    const interval = setInterval(fetchLatest, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [otherAssignment?.id])

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Back button */}
      <Link
        to="/interviewer"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center">
              <Video className="w-5 h-5 mr-2 text-blue-600" />
              Interview:{' '}
              {applicant
                ? `${applicant.firstName} ${applicant.lastName}`
                : 'Applicant'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <span className="flex items-center">
                <Clock className="w-4 h-4 mr-1 text-gray-400" />
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
                <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                  {domain}
                </span>
              )}
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  isCompleted
                    ? 'bg-green-100 text-green-700'
                    : STATUS_COLORS[interview.status] ??
                      'bg-gray-100 text-gray-700'
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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <button
          onClick={() => setShowApplication(!showApplication)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 rounded-xl"
        >
          <span className="flex items-center text-lg font-semibold text-gray-900">
            <FileText className="w-5 h-5 mr-2 text-blue-600" />
            Application
          </span>
          <ChevronDown
            className={`w-5 h-5 text-gray-400 transition-transform ${
              showApplication ? 'rotate-180' : ''
            }`}
          />
        </button>
        {showApplication && (
          <div className="px-6 pb-6 space-y-6 border-t border-gray-100 pt-6">
            {generalQuestions.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  General Application
                </h3>
                {generalQuestions.map((q: any) => {
                  const answer = application?.answers?.[q.key]
                  return (
                    <div key={q.key}>
                      <div className="text-sm font-medium text-gray-700 mb-1">
                        {q.data?.label ?? q.key}
                      </div>
                      <div className="text-sm text-gray-900 bg-gray-50 rounded p-3 whitespace-pre-wrap">
                        {answer || (
                          <span className="text-gray-400 italic">
                            No answer provided
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {domainQuestions.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  {domain} Challenge
                </h3>
                {domainQuestions.map((q: any) => {
                  const answer = interview.domainApplication?.answers?.[q.key]
                  return (
                    <div key={q.key}>
                      <div className="text-sm font-medium text-gray-700 mb-1">
                        {q.data?.label ?? q.key}
                      </div>
                      <div className="text-sm text-gray-900 bg-gray-50 rounded p-3 whitespace-pre-wrap">
                        {answer || (
                          <span className="text-gray-400 italic">
                            No answer provided
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reviewer Notes (collapsible) */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <button
          onClick={() => setShowReviews(!showReviews)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 rounded-xl"
        >
          <span className="flex items-center text-lg font-semibold text-gray-900">
            <MessageSquare className="w-5 h-5 mr-2 text-blue-600" />
            Reviewer Notes ({submittedReviews.length})
          </span>
          <ChevronDown
            className={`w-5 h-5 text-gray-400 transition-transform ${
              showReviews ? 'rotate-180' : ''
            }`}
          />
        </button>
        {showReviews && (
          <div className="px-6 pb-6 border-t border-gray-100 pt-6">
            {submittedReviews.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No submitted reviews for this applicant.
              </p>
            ) : (
              <div className="space-y-6">
                {submittedReviews.map((review: any) => {
                  const m = review.cycleReviewer?.daliMember
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
                      className="border border-gray-200 rounded-lg p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">
                            {reviewerName}
                          </div>
                          {review.submittedAt && (
                            <div className="text-xs text-gray-500">
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
                              className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1"
                            >
                              <span className="text-gray-600">
                                {criteriaByKey[key]?.label ?? key}
                              </span>
                              <span className="font-semibold text-gray-900">
                                {score}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {review.feedback && (
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                            Feedback
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded p-3">
                            {review.feedback}
                          </p>
                        </div>
                      )}
                      {review.rejectionRationale && (
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                            Rejection rationale
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded p-3">
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

      {/* Two-column notes layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Notes */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">My Notes</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full h-48 p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
            placeholder="Write your interview notes here..."
            disabled={isCompleted}
          />
          <div className="mt-2 flex items-center text-xs text-gray-500">
            <SaveStatusIndicator saving={showSaving} lastSaved={lastSaved} />
          </div>

          {/* Note history */}
          {myNoteVersions.length > 1 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center text-sm text-gray-600 hover:text-gray-800"
              >
                <ChevronDown
                  className={`w-4 h-4 mr-1 transition-transform ${
                    showHistory ? 'rotate-180' : ''
                  }`}
                />
                Note History ({myNoteVersions.length} versions)
              </button>
              {showHistory && (
                <div className="mt-3 space-y-3 max-h-64 overflow-y-auto">
                  {myNoteVersions.map((version: any, idx: number) => {
                    const isLatest = idx === 0
                    const matchesCurrent = version.content === notes
                    return (
                      <div
                        key={version.id}
                        className="p-3 bg-gray-50 rounded-lg border border-gray-100"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-gray-400">
                            {new Date(version.createdAt).toLocaleString()}
                            {isLatest && ' (latest)'}
                          </p>
                          <button
                            onClick={() => handleRestoreVersion(version.content)}
                            disabled={isCompleted || matchesCurrent}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-300 disabled:cursor-not-allowed"
                          >
                            Restore
                          </button>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">
                          {version.content || (
                            <span className="text-gray-400 italic">(empty)</span>
                          )}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Other Interviewer's Notes */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {otherAssignment
              ? `${
                  otherAssignment.cycleInterviewer?.daliMember?.firstName ?? ''
                } ${
                  otherAssignment.cycleInterviewer?.daliMember?.lastName ?? ''
                }`.trim() + "'s Notes"
              : "Other Interviewer's Notes"}
          </h2>
          {otherAssignment ? (
            <>
              {otherLatestNote ? (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 min-h-[12rem]">
                  <p className="text-xs text-gray-400 mb-2">
                    {new Date(otherLatestNote.createdAt).toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {otherLatestNote.content}
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 min-h-[12rem] flex items-center justify-center">
                  <p className="text-sm text-gray-400">No notes yet.</p>
                </div>
              )}
            </>
          ) : (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 min-h-[12rem] flex items-center justify-center">
              <p className="text-sm text-gray-400">
                No other interviewer assigned.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Joint Recommendation */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
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
                className="text-xs font-medium text-green-700 hover:text-green-900 underline disabled:text-gray-400 disabled:no-underline"
              >
                {completing ? 'Reopening…' : 'Reopen'}
              </button>
            </div>
            <p className="text-sm text-green-700">
              <strong>Recommendation:</strong>{' '}
              {interview.recommendation ?? recommendation}
            </p>
            {(interview.recommendationNotes ?? recommendationNotes) && (
              <p className="text-sm text-green-700 mt-1">
                <strong>Notes:</strong>{' '}
                {interview.recommendationNotes ?? recommendationNotes}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recommendation Notes
              </label>
              <textarea
                value={recommendationNotes}
                onChange={(e) => setRecommendationNotes(e.target.value)}
                className="w-full h-24 p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                placeholder="Joint notes on the recommendation..."
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveRecommendation}
                disabled={savingRecommendation || !recommendation}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                <Save className="w-4 h-4 mr-1.5" />
                {savingRecommendation ? 'Saving...' : 'Save Draft'}
              </button>
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
  )
}
