import { useState, useEffect, useRef } from 'react'
import { Link, redirect, useLoaderData, useSubmit } from 'react-router'
import { ArrowLeft, HelpCircle, X, Check } from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth, withAuth } from '~/lib/auth'
import { hasCycleAccess } from '~/lib/roles'
import { parseAccessToken } from '~/lib/cookies'
import { requirePageSignedOrRedirect } from '~/hiring/lib/confidentiality'
import { presignAnswers } from '~/hiring/lib/presign'
import type { Route } from './+types/reviewer.application.$id'
import { ApplicationViewer } from '~/hiring/components/ApplicationViewer'
import { SaveStatusIndicator } from '~/hiring/components/SaveStatusIndicator'
import { CollaborativeEditor } from '~/components/CollaborativeEditor'
import { PresenceProvider } from '~/components/collab/PresenceProvider'
import { PresenceBar } from '~/components/collab/PresenceBar'
import type { Question, RubricCriterion } from '~/types'

export const meta: Route.MetaFunction = ({ data }) => {
  const user = data?.application?.user
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  return [{ title: `${name || 'Application'} · Reviewer · DALI OS` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))

  const applicationBase = await prisma.application.findUniqueOrThrow({
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
    },
  })

  if (!(await hasCycleAccess(auth.user.sub, applicationBase.applicationCycleId)))
    throw redirect('/login')

  const confRedirect = await requirePageSignedOrRedirect(
    auth.user.sub,
    applicationBase.applicationCycleId,
    request,
  )
  if (confRedirect) return confRedirect

  // Scope domainApplications to only the domains this reviewer is assigned to
  // for this cycle. Reviewers assigned to one domain should not see that the
  // applicant also applied to other domains.
  const cycleReviewers = await prisma.cycleReviewer.findMany({
    where: {
      applicationCycleId: applicationBase.applicationCycleId,
      daliMember: { userId: auth.user.sub },
    },
    select: { id: true, domainId: true },
  })
  const reviewerDomainIds = cycleReviewers.map((cr) => cr.domainId)

  const [reviewer, domainApplications, existingReview] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: auth.user.sub } }),
    prisma.domainApplication.findMany({
      where: {
        applicationId: params.id,
        selected: true,
        challengeVersion: { domainId: { in: reviewerDomainIds } },
      },
      include: {
        challengeVersion: {
          include: { domain: true, challenge: true },
        },
      },
    }),
    prisma.applicationReview.findFirst({
      where: {
        domainApplication: { applicationId: params.id },
        cycleReviewer: { daliMember: { userId: auth.user.sub } },
      },
    }),
  ])

  // Presign file-type answers so the viewer can render real download links
  // instead of raw S3 keys.
  const generalQuestionsForPresign =
    (applicationBase.generalChallengeVersion?.questions as unknown as Question[]) ?? []
  const presignedGeneralAnswers = await presignAnswers(
    generalQuestionsForPresign,
    applicationBase.answers as Record<string, string>,
  )
  const presignedDomainApplications = await Promise.all(
    domainApplications.map(async (da: any) => ({
      ...da,
      answers: await presignAnswers(
        (da.challengeVersion.questions as unknown as Question[]) ?? [],
        da.answers as Record<string, string>,
      ),
    })),
  )

  const application = {
    ...applicationBase,
    answers: presignedGeneralAnswers,
    domainApplications: presignedDomainApplications,
  }

  // If this reviewer is assigned to a domain on this application but no
  // ApplicationReview row exists yet, create one so the collaborative editors
  // for feedback/rejection rationale render editable. Without this, the page
  // shows disabled textareas with a "Save the review first" placeholder — but
  // there is no save button for these fields (they save via collab sync).
  let review = existingReview
  if (!review) {
    const cycleReviewer = cycleReviewers.find((cr) =>
      domainApplications.some((da) => da.challengeVersion.domainId === cr.domainId),
    )
    const matchingDa = cycleReviewer
      ? domainApplications.find(
          (da) => da.challengeVersion.domainId === cycleReviewer.domainId,
        )
      : null
    if (cycleReviewer && matchingDa) {
      review = await prisma.applicationReview.upsert({
        where: {
          cycleReviewerId_domainApplicationId: {
            cycleReviewerId: cycleReviewer.id,
            domainApplicationId: matchingDa.id,
          },
        },
        create: {
          cycleReviewerId: cycleReviewer.id,
          domainApplicationId: matchingDa.id,
        },
        update: {},
      })
    }
  }

  // Pass JWT for WebSocket auth
  const collabToken = parseAccessToken(request)
  const userName = [reviewer.firstName, reviewer.lastName].filter(Boolean).join(' ') || auth.user.email

  return withAuth(auth, { application, reviewer, existingReview: review, collabToken, userName })
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'save-review') {
    const scores = JSON.parse(formData.get('scores') as string)
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
        data: { scores, overallRecommendation, annotations },
      })
    }
  }

  return withAuth(auth, null)
}

const RECOMMENDATIONS = ['Strong Hire', 'Hire', 'Lean Hire', 'Lean No Hire', 'No Hire'] as const

export default function ReviewerApplicationReview() {
  const { application, reviewer, existingReview, collabToken, userName } = useLoaderData<typeof loader>()
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
    overallRecommendation: string | null
    annotations: object[]
  }) => {
    const formData = new FormData()
    formData.set('intent', 'save-review')
    formData.set('reviewerId', reviewer.id)
    formData.set('scores', JSON.stringify(data.scores))
    formData.set('overallRecommendation', data.overallRecommendation ?? '')
    formData.set('annotations', JSON.stringify(data.annotations))
    submit(formData, { method: 'post' })
  }

  const isSubmitted = !!existingReview?.submittedAt

  // Auto-save scores, recommendation, and annotations on change.
  // Feedback and rejectionRationale are handled by the collab server.
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (isSubmitted) return
    setIsSaving(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      submitReview({ scores, overallRecommendation, annotations })
      setTimeout(() => {
        setIsSaving(false)
        setLastSaved(new Date())
      }, 400)
    }, 1000)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [scores, overallRecommendation, annotations])

  const flushSave = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    submitReview({ scores, overallRecommendation, annotations })
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
    <PresenceProvider
      pageId={`review:${existingReview?.id ?? application.id}`}
      token={collabToken}
      userName={userName}
    >
    <div className="space-y-6 pb-12 relative">
      <div>
        <div className="flex items-center justify-between mb-4">
          <Link to="/hiring/reviewer" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground/80">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
          </Link>
          <PresenceBar />
        </div>
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Review: {application.user.firstName} {application.user.lastName}
            </h1>
            <p className="mt-1 text-muted-foreground">{cycle.name}</p>
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
          <div className="bg-card rounded-xl border border-border shadow-sm sticky top-24">
            <div className="px-6 py-4 border-b border-border bg-blue-50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-blue-900">Your Review</h2>
              {!isSubmitted && (
                <SaveStatusIndicator saving={isSaving} lastSaved={lastSaved} />
              )}
            </div>
            <div className="p-6 space-y-6">

              {/* Scoring */}
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4">Scoring</h3>
                {flatCriteria.length === 0 ? (
                  <p className="text-sm text-muted-foreground/70 italic">No rubric attached to this application.</p>
                ) : (
                  <div className="space-y-6">
                    {allCriteria.map((section) => (
                      <div key={section.sectionLabel}>
                        {allCriteria.length > 1 && (
                          <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-3">{section.sectionLabel}</p>
                        )}
                        <div className="space-y-4">
                          {section.criteria.map((criterion) => (
                            <div key={criterion.key}>
                              <div className="flex justify-between items-center mb-1">
                                <label className="text-sm font-medium text-foreground">{criterion.label}</label>
                                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                  {scores[criterion.key] ?? 0} / {criterion.maxScore}
                                </span>
                              </div>
                              {criterion.description && (
                                <p className="text-xs text-muted-foreground mb-1">{criterion.description}</p>
                              )}
                              <input
                                type="range" min="0" max={criterion.maxScore}
                                value={scores[criterion.key] ?? 0}
                                onChange={(e) => setScores((prev) => ({ ...prev, [criterion.key]: parseInt(e.target.value) }))}
                                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-600"
                              />
                              <div className="flex justify-between text-xs text-muted-foreground/70 mt-1"><span>0</span><span>{criterion.maxScore}</span></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Feedback — collaborative editor */}
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-2">Internal Feedback</h3>
                <p className="text-xs text-muted-foreground mb-2">Notes for other reviewers. Not visible to applicant.</p>
                {existingReview && collabToken ? (
                  <CollaborativeEditor
                    editorId="feedback"
                    documentName={`review:${existingReview.id}:feedback`}
                    token={collabToken}
                    userName={userName}
                    disabled={isSubmitted}
                    placeholder="Strengths, weaknesses, areas to probe in interview..."
                  />
                ) : (
                  <textarea
                    rows={4}
                    disabled
                    className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm border p-2 text-foreground bg-muted/50"
                    placeholder="Save the review first to enable collaborative editing..."
                  />
                )}
              </div>

              {/* Rejection Rationale — collaborative editor */}
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-2">
                  Rejection Rationale <span className="text-xs font-normal text-muted-foreground normal-case">(Optional)</span>
                </h3>
                {existingReview && collabToken ? (
                  <CollaborativeEditor
                    editorId="rejectionRationale"
                    documentName={`review:${existingReview.id}:rejectionRationale`}
                    token={collabToken}
                    userName={userName}
                    disabled={isSubmitted}
                    placeholder="If we reject this candidate, what feedback should we provide?"
                  />
                ) : (
                  <textarea
                    rows={3}
                    disabled
                    className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm border p-2 text-foreground bg-muted/50"
                    placeholder="Save the review first to enable collaborative editing..."
                  />
                )}
              </div>

              {/* Overall Recommendation */}
              <div className="pt-4 border-t border-border">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Overall Recommendation</h3>
                <div className="space-y-2">
                  {RECOMMENDATIONS.map((rec) => (
                    <label key={rec} className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${overallRecommendation === rec ? 'border-blue-500 bg-blue-50' : 'border-border hover:bg-muted/50'}`}>
                      <input
                        type="radio" name="recommendation" value={rec}
                        checked={overallRecommendation === rec}
                        onChange={() => setOverallRecommendation(rec)}
                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="ml-3 text-sm font-medium text-foreground">{rec}</span>
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
                          const res = await fetch(`/api/hiring/reviews/${existingReview.id}/submit`, {
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
                        const res = await fetch(`/api/hiring/reviews/${existingReview.id}/unsubmit`, {
                          method: 'POST', credentials: 'include',
                        })
                        if (res.ok) window.location.reload()
                      }}
                      className="w-full flex justify-center items-center px-4 py-2 text-sm font-medium rounded-lg text-foreground/80 bg-card border border-gray-300 hover:bg-muted/50"
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
      <div className="fixed bottom-6 right-4 sm:bottom-8 sm:right-8 flex flex-col gap-4 z-50">
        <button
          onClick={() => setShowRubric(!showRubric)}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${showRubric ? 'bg-blue-600 text-white' : 'bg-card text-blue-600 hover:bg-blue-50 border border-border'}`}
          title="Scoring Guide"
        >
          {showRubric ? <X className="w-6 h-6" /> : <HelpCircle className="w-6 h-6" />}
        </button>
      </div>

      {showRubric && (
        <div className="fixed bottom-20 right-4 sm:bottom-24 sm:right-8 w-80 max-w-[calc(100vw-2rem)] bg-card rounded-xl shadow-2xl border border-border overflow-hidden z-50">
          <div className="bg-blue-600 px-4 py-3 flex justify-between items-center">
            <h3 className="font-bold text-white flex items-center"><HelpCircle className="w-4 h-4 mr-2" />Scoring Guide</h3>
          </div>
          <ul className="divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
            {flatCriteria.length === 0 ? (
              <li className="p-4 text-sm text-muted-foreground/70 italic">No rubric attached.</li>
            ) : flatCriteria.map((c) => (
              <li key={c.key} className="p-4 hover:bg-muted/50">
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-foreground">{c.label}</h4>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">Max: {c.maxScore}</span>
                </div>
                {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
    </PresenceProvider>
  )
}
