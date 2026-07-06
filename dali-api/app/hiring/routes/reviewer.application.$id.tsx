import { useState, useEffect, useRef } from 'react'
import { redirect, useLoaderData, useSubmit } from 'react-router'
import { HelpCircle, X, Check } from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from '~/lib/roles'
import { parseSessionCookie } from '~/lib/cookies'
import { getPresenceUser } from '~/lib/presence-user'
import { requirePageSignedOrRedirect } from '~/hiring/lib/confidentiality'
import { presignAnswers } from '~/hiring/lib/presign'
import type { Route } from './+types/reviewer.application.$id'
import { ApplicationViewer } from '~/hiring/components/ApplicationViewer'
import { SaveStatusIndicator } from '~/hiring/components/SaveStatusIndicator'
import { CollaborativeEditor } from '~/components/CollaborativeEditor'
import { PresenceProvider } from '~/components/collab/PresenceProvider'
import { PresenceBar } from '~/components/collab/PresenceBar'
import { getEducationEngagement } from '~/education/lib/engagement.server'
import { EducationEngagementPanel } from '~/education/components/EducationEngagementPanel'
import type { Question, RubricCriterion } from '~/types'

export const meta: Route.MetaFunction = ({ data }) => {
  const user = data?.application?.user
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  return [{ title: `${name || 'Application'} · Reviewer · DALI OS` }]
}

export const handle = {
  breadcrumb: (data: unknown) => {
    const user = (
      data as { application?: { user?: { firstName?: string; lastName?: string } } } | undefined
    )?.application?.user
    return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || undefined
  },
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const applicationBase = await prisma.application.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      user: true,
      generalChallengeVersion: true,
      internToFullFormVersion: true,
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

  const isInternToFull = applicationBase.applicationCycle.cycleType === 'InternToFull'

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
      userId: auth.user.sub,
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
        // Standard cycles link Domain via challengeVersion; InternToFull cycles
        // link Domain directly. Match whichever path is set.
        OR: [
          { challengeVersion: { domainId: { in: reviewerDomainIds } } },
          { domainId: { in: reviewerDomainIds } },
        ],
      },
      include: {
        challengeVersion: {
          include: { domain: true, challenge: true },
        },
        domain: true,
      },
    }),
    prisma.applicationReview.findFirst({
      where: {
        domainApplication: { applicationId: params.id },
        cycleReviewer: { userId: auth.user.sub },
      },
    }),
  ])

  // Helper: resolve a domainApplication's effective Domain regardless of cycleType.
  function daDomain(da: (typeof domainApplications)[number]) {
    return da.domain ?? da.challengeVersion?.domain ?? null
  }
  function daDomainId(da: (typeof domainApplications)[number]): string | null {
    return da.domainId ?? da.challengeVersion?.domainId ?? null
  }

  // Presign file-type answers so the viewer can render real download links
  // instead of raw S3 keys. For InternToFull cycles, the application's
  // "general" questions live on internToFullFormVersion, and per-domain
  // entries carry no challenge content.
  const generalQuestionsForPresign = isInternToFull
    ? ((applicationBase.internToFullFormVersion?.questions as unknown as Question[]) ?? [])
    : ((applicationBase.generalChallengeVersion?.questions as unknown as Question[]) ?? [])
  const presignedGeneralAnswers = await presignAnswers(
    generalQuestionsForPresign,
    applicationBase.answers as Record<string, string>,
  )
  const presignedDomainApplications = await Promise.all(
    domainApplications.map(async (da: any) => ({
      ...da,
      answers: await presignAnswers(
        (da.challengeVersion?.questions as unknown as Question[]) ?? [],
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
      domainApplications.some((da) => daDomainId(da) === cr.domainId),
    )
    const matchingDa = cycleReviewer
      ? domainApplications.find((da) => daDomainId(da) === cycleReviewer.domainId)
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
  const collabToken = parseSessionCookie(request)
  const fallbackName =
    [reviewer.firstName, reviewer.lastName].filter(Boolean).join(' ') || auth.user.email
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName)
  const userName = presenceUser?.name ?? fallbackName

  // Education engagement ("demonstrated interest") — includes internal
  // instructor notes; this page is behind cycle access + confidentiality.
  const educationEngagement = await getEducationEngagement(applicationBase.user.id)

  return {
    application,
    reviewer,
    existingReview: review,
    educationEngagement,
    collabToken,
    userName,
    currentUserId: auth.user.sub,
    presencePhotoUrl: presenceUser?.photoUrl ?? null,
    presenceSubtitle: presenceUser?.subtitle ?? null,
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'save-review') {
    const scores = JSON.parse(formData.get('scores') as string)
    const overallRecommendation = (formData.get('overallRecommendation') as string) || null
    const annotations = JSON.parse((formData.get('annotations') as string) ?? '[]')

    const existing = await prisma.applicationReview.findFirst({
      where: {
        domainApplication: { applicationId: params.id },
        cycleReviewer: { userId: auth.user.sub },
      },
      include: {
        domainApplication: {
          select: {
            domainId: true,
            challengeVersion: { select: { domainId: true } },
            application: { select: { applicationCycleId: true } },
          },
        },
      },
    })

    if (existing) {
      // Pin the rubric version these score keys belong to, so a later rubric
      // edit (which mints new crit-<ts> keys) doesn't orphan them at render
      // time. Prefer the per-domain rubric (Standard cycles); fall back to the
      // cycle-level general rubric (InternToFull, which has no per-domain).
      const da = existing.domainApplication
      const domainId = da.domainId ?? da.challengeVersion?.domainId ?? null
      let rubricVersionId: string | null = existing.rubricVersionId ?? null
      if (domainId) {
        const dac = await prisma.domainApplicationCycle.findUnique({
          where: {
            domainId_applicationCycleId: {
              domainId,
              applicationCycleId: da.application.applicationCycleId,
            },
          },
          select: { rubricVersionId: true },
        })
        if (dac?.rubricVersionId) rubricVersionId = dac.rubricVersionId
      }
      if (!rubricVersionId) {
        const ac = await prisma.applicationCycle.findUnique({
          where: { id: da.application.applicationCycleId },
          select: { generalRubricVersionId: true },
        })
        if (ac?.generalRubricVersionId) rubricVersionId = ac.generalRubricVersionId
      }

      await prisma.applicationReview.update({
        where: { id: existing.id },
        data: { scores, overallRecommendation, annotations, rubricVersionId },
      })
    }
  }

  return null
}

const RECOMMENDATIONS = ['Strong Hire', 'Hire', 'Lean Hire', 'Lean No Hire', 'No Hire'] as const

export default function ReviewerApplicationReview() {
  const {
    application,
    reviewer,
    existingReview,
    educationEngagement,
    collabToken,
    userName,
    currentUserId,
    presencePhotoUrl,
    presenceSubtitle,
  } = useLoaderData<typeof loader>()
  const submit = useSubmit()

  const cycle = application.applicationCycle
  const isInternToFull = cycle.cycleType === 'InternToFull'
  const generalCv = application.generalChallengeVersion
  const formQuestions = isInternToFull
    ? ((application.internToFullFormVersion?.questions as unknown as Question[]) ?? [])
    : ((generalCv?.questions as unknown as Question[]) ?? [])

  // Collect all rubric criteria: general form rubric + per-domain-application rubrics
  const allCriteria: { sectionLabel: string; criteria: RubricCriterion[] }[] = []
  const generalRubricVersion = cycle.generalRubricVersion
  if (generalRubricVersion) {
    const criteria = generalRubricVersion.criteria as unknown as RubricCriterion[]
    if (criteria.length > 0) allCriteria.push({ sectionLabel: 'General Application', criteria })
  }
  for (const da of application.domainApplications) {
    const dDomainId = (da as any).domainId ?? (da as any).challengeVersion?.domainId ?? null
    const dDomain = (da as any).domain ?? (da as any).challengeVersion?.domain ?? null
    if (!dDomainId || !dDomain) continue
    const domainCycle = cycle.domains?.find((dc: any) => dc.domainId === dDomainId)
    const rv = domainCycle?.rubricVersion
    if (rv) {
      const criteria = rv.criteria as unknown as RubricCriterion[]
      if (criteria.length > 0) {
        allCriteria.push({ sectionLabel: dDomain.displayName ?? dDomain.name, criteria })
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
    const qs = ((da as any).challengeVersion?.questions as unknown as Question[]) ?? []
    for (const q of qs) {
      questionLabels[q.key] = q.data.label
    }
  }

  return (
    <PresenceProvider
      pageId={`review:${existingReview?.id ?? application.id}`}
      token={collabToken}
      userName={userName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
    <div className="space-y-6 pb-12 relative">
      <div>
        <div className="flex items-center justify-end mb-4">
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
        <div className="lg:col-span-2 space-y-6">
          <EducationEngagementPanel entries={educationEngagement} />
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
