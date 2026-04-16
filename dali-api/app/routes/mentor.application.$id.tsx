import { useState, useEffect, useRef } from 'react'
import { Link, redirect, useLoaderData, useSubmit } from 'react-router'
import { ArrowLeft, HelpCircle, X, Check } from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import type { Route } from './+types/mentor.application.$id'
import { ApplicationViewer } from '~/components/ApplicationViewer'
import { SaveStatusIndicator } from '~/components/SaveStatusIndicator'
import type { Question, RubricCriterion } from '~/types'

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const [application, mentor, existingReview] = await Promise.all([
    prisma.application.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        user: true,
        generalChallengeVersion: true,
        applicationCycle: {
          include: {
            statusUpdates: { orderBy: { createdAt: 'desc' }, take: 1 },
            generalRubricVersion: { include: { rubric: true } },
            domains: {
              include: {
                rubricVersion: { include: { rubric: true } },
                domain: true,
              },
            },
          },
        },
        domainApplications: {
          include: {
            challengeVersion: {
              include: {
                domain: true,
                challenge: true,
              },
            },
          },
        },
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: auth.user.sub } }),
    prisma.applicationReview.findFirst({
      where: {
        domainApplication: { applicationId: params.id },
        cycleReviewer: { daliMember: { userId: auth.user.sub } },
      },
    }),
  ])

  return { application, mentor, existingReview }
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'save-review') {
    const scores = JSON.parse(formData.get('scores') as string)
    const feedback = (formData.get('feedback') as string) ?? ''
    const rejectionRationale = (formData.get('rejectionRationale') as string) ?? ''
    const overallRecommendation = (formData.get('overallRecommendation') as string) || null
    const annotations = JSON.parse((formData.get('annotations') as string) ?? '[]')

    const existing = await prisma.applicationReview.findFirst({
      where: {
        domainApplication: { applicationId: params.id },
        cycleReviewer: { daliMember: { userId: auth.user.sub } },
      },
    })

    if (existing) {
      await prisma.applicationReview.update({
        where: { id: existing.id },
        data: { scores, feedback, rejectionRationale, overallRecommendation, annotations },
      })
    }
  }

  return null
}

const RECOMMENDATIONS = ['Strong Hire', 'Hire', 'Lean Hire', 'Lean No Hire', 'No Hire'] as const

export default function MentorApplicationReview() {
  const { application, mentor, existingReview } = useLoaderData<typeof loader>()
  const submit = useSubmit()

  const cycle = application.applicationCycle
  const generalCv = application.generalChallengeVersion
  const formQuestions = (generalCv?.questions as unknown as Question[]) ?? []

  // Collect all rubric criteria: general form rubric + per-domain-application rubrics
  const allCriteria: { sectionLabel: string; criteria: RubricCriterion[] }[] = []
  const generalRubricVersion = cycle.generalRubricVersion
  if (generalRubricVersion) {
    const criteria = generalRubricVersion.criteria as unknown as RubricCriterion[]
    if (criteria.length > 0) allCriteria.push({ sectionLabel: 'General Application', criteria })
  }
  for (const da of application.domainApplications) {
    const domainCycle = cycle.domains?.find((dc: any) => dc.domainId === da.challengeVersion.domainId)
    const rv = domainCycle?.rubricVersion
    if (rv) {
      const criteria = rv.criteria as unknown as RubricCriterion[]
      if (criteria.length > 0) {
        allCriteria.push({ sectionLabel: da.challengeVersion.domain.name, criteria })
      }
    }
  }
  const flatCriteria = allCriteria.flatMap((s) => s.criteria)

  const [scores, setScores] = useState<Record<string, number>>(
    (existingReview?.scores as Record<string, number>) ?? {}
  )
  const [feedback, setFeedback] = useState(existingReview?.feedback ?? '')
  const [rejectionRationale, setRejectionRationale] = useState(existingReview?.rejectionRationale ?? '')
  const [overallRecommendation, setOverallRecommendation] = useState<string | null>(
    existingReview?.overallRecommendation ?? null
  )
  const [annotations, setAnnotations] = useState<object[]>(
    (existingReview?.annotations as object[]) ?? []
  )
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(
    existingReview?.updatedAt ? new Date(existingReview.updatedAt) : null,
  )
  const [showRubric, setShowRubric] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)

  const submitReview = (data: {
    scores: Record<string, number>
    feedback: string
    rejectionRationale: string
    overallRecommendation: string | null
    annotations: object[]
  }) => {
    const formData = new FormData()
    formData.set('intent', 'save-review')
    formData.set('mentorId', mentor.id)
    formData.set('scores', JSON.stringify(data.scores))
    formData.set('feedback', data.feedback)
    formData.set('rejectionRationale', data.rejectionRationale)
    formData.set('overallRecommendation', data.overallRecommendation ?? '')
    formData.set('annotations', JSON.stringify(data.annotations))
    submit(formData, { method: 'post' })
  }

  const isSubmitted = !!existingReview?.submittedAt

  // Auto-save on any change: flip to "Saving…" immediately on edit, fire the
  // actual request after a 1s debounce, then flip to "Saved at …" once the
  // request flushes. Skipped while the review is already submitted.
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (isSubmitted) return
    setIsSaving(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      submitReview({ scores, feedback, rejectionRationale, overallRecommendation, annotations })
      setTimeout(() => {
        setIsSaving(false)
        setLastSaved(new Date())
      }, 400)
    }, 1000)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [scores, feedback, rejectionRationale, overallRecommendation, annotations])

  // Flush any pending debounce synchronously — used before "Submit Review" so
  // the latest content is persisted before the server-side submit lock engages.
  const flushSave = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    submitReview({ scores, feedback, rejectionRationale, overallRecommendation, annotations })
    setIsSaving(false)
    setLastSaved(new Date())
  }

  // Build question label lookup from form + challenge versions
  const questionLabels: Record<string, string> = {}
  for (const q of formQuestions) {
    questionLabels[q.key] = q.data.label
  }
  for (const da of application.domainApplications) {
    const qs = da.challengeVersion.questions as unknown as Question[]
    for (const q of qs) {
      questionLabels[q.key] = q.data.label
    }
  }

  return (
    <div className="space-y-6 pb-12 relative">
      <div>
        <Link to="/reviewer" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
        </Link>
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Review: {application.user.firstName} {application.user.lastName}
            </h1>
            <p className="mt-1 text-gray-500">{cycle.name}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Application Content */}
        <div className="lg:col-span-2">
          <ApplicationViewer
            application={application}
            questionLabels={questionLabels}
            initialAnnotations={annotations}
            onAnnotationsChange={setAnnotations}
          />
        </div>

        {/* Right: Review Form */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-24">
            <div className="px-6 py-4 border-b border-gray-200 bg-blue-50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-blue-900">Your Review</h2>
              {!isSubmitted && (
                <SaveStatusIndicator saving={isSaving} lastSaved={lastSaved} />
              )}
            </div>
            <div className="p-6 space-y-6">

              {/* Scoring */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Scoring</h3>
                {flatCriteria.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No rubric attached to this application.</p>
                ) : (
                  <div className="space-y-6">
                    {allCriteria.map((section) => (
                      <div key={section.sectionLabel}>
                        {allCriteria.length > 1 && (
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{section.sectionLabel}</p>
                        )}
                        <div className="space-y-4">
                          {section.criteria.map((criterion) => (
                            <div key={criterion.key}>
                              <div className="flex justify-between items-center mb-1">
                                <label className="text-sm font-medium text-gray-900">{criterion.label}</label>
                                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                  {scores[criterion.key] ?? 0} / {criterion.maxScore}
                                </span>
                              </div>
                              {criterion.description && (
                                <p className="text-xs text-gray-500 mb-1">{criterion.description}</p>
                              )}
                              <input
                                type="range" min="0" max={criterion.maxScore}
                                value={scores[criterion.key] ?? 0}
                                onChange={(e) => setScores((prev) => ({ ...prev, [criterion.key]: parseInt(e.target.value) }))}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                              />
                              <div className="flex justify-between text-xs text-gray-400 mt-1"><span>0</span><span>{criterion.maxScore}</span></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Feedback */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2">Internal Feedback</h3>
                <p className="text-xs text-gray-500 mb-2">Notes for other reviewers. Not visible to applicant.</p>
                <textarea
                  rows={4} value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="block w-full rounded-md border-black shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 text-gray-900 bg-white"
                  placeholder="Strengths, weaknesses, areas to probe in interview..."
                />
              </div>

              {/* Rejection Rationale */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2">
                  Rejection Rationale <span className="text-xs font-normal text-gray-500 normal-case">(Optional)</span>
                </h3>
                <textarea
                  rows={3} value={rejectionRationale}
                  onChange={(e) => setRejectionRationale(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 text-gray-900 bg-white"
                  placeholder="If we reject this candidate, what feedback should we provide?"
                />
              </div>

              {/* Overall Recommendation */}
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Overall Recommendation</h3>
                <div className="space-y-2">
                  {RECOMMENDATIONS.map((rec) => (
                    <label key={rec} className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${overallRecommendation === rec ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input
                        type="radio" name="recommendation" value={rec}
                        checked={overallRecommendation === rec}
                        onChange={() => setOverallRecommendation(rec)}
                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="ml-3 text-sm font-medium text-gray-900">{rec}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <div className="pt-4 space-y-2">
                {!existingReview?.submittedAt ? (
                  <>
                    {existingReview && (
                      <button
                        onClick={async () => {
                          flushSave()
                          const res = await fetch(`/api/reviews/${existingReview.id}/submit`, {
                            method: 'POST', credentials: 'include',
                          })
                          if (res.ok) window.location.reload()
                        }}
                        className="w-full flex justify-center items-center px-4 py-3 text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 shadow-sm"
                      >
                        Submit Review
                      </button>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 py-3 bg-green-50 border border-green-200 rounded-lg">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-sm font-medium text-green-800">Review Submitted</span>
                    </div>
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/reviews/${existingReview.id}/unsubmit`, {
                          method: 'POST', credentials: 'include',
                        })
                        if (res.ok) window.location.reload()
                      }}
                      className="w-full flex justify-center items-center px-4 py-2 text-sm font-medium rounded-lg text-gray-700 bg-white border border-gray-300 hover:bg-gray-50"
                    >
                      Unsubmit & Edit
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating rubric toggle */}
      <div className="fixed bottom-8 right-8 flex flex-col gap-4 z-50">
        <button
          onClick={() => setShowRubric(!showRubric)}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${showRubric ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 hover:bg-blue-50 border border-gray-200'}`}
          title="Scoring Guide"
        >
          {showRubric ? <X className="w-6 h-6" /> : <HelpCircle className="w-6 h-6" />}
        </button>
      </div>

      {showRubric && (
        <div className="fixed bottom-24 right-8 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50">
          <div className="bg-blue-600 px-4 py-3 flex justify-between items-center">
            <h3 className="font-bold text-white flex items-center"><HelpCircle className="w-4 h-4 mr-2" />Scoring Guide</h3>
          </div>
          <ul className="divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
            {flatCriteria.length === 0 ? (
              <li className="p-4 text-sm text-gray-400 italic">No rubric attached.</li>
            ) : flatCriteria.map((c) => (
              <li key={c.key} className="p-4 hover:bg-gray-50">
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-gray-900">{c.label}</h4>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">Max: {c.maxScore}</span>
                </div>
                {c.description && <p className="text-xs text-gray-500">{c.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
