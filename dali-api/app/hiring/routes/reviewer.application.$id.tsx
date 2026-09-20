import { useState, useEffect, useRef } from 'react'
import { useOsChrome } from '~/components/os-chrome'
import { buttonClasses } from '~/components/ui/Button'
import { cn } from '~/lib/cn'
import { redirect, useLoaderData, useSubmit } from 'react-router'
import { HelpCircle, X, Check } from 'lucide-react'
import { prisma } from '~/lib/db'
import { recordRouteVisit } from '~/lib/user-pages.server'
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from '~/lib/login-next'
import { hasCycleAccess } from '~/lib/roles'
import { parseSessionCookie } from '~/lib/cookies'
import { getPresenceUser } from '~/lib/presence-user'
import { requirePageSignedOrRedirect } from '~/hiring/lib/confidentiality'
import { presignAnswers } from '~/hiring/lib/presign'
import { anonLabelMapForCycle, releasedDaIds, blindUser, anonLabel } from '~/hiring/lib/anonymization.server'
import { ensureBlocks } from '~/collab/legacy/pm-to-blocknote'
import { safeParseJsonString } from '~/forms/lib/forms-data'
import type { Route } from './+types/reviewer.application.$id'
import { ApplicationViewer } from '~/hiring/components/ApplicationViewer'
import { SaveStatusIndicator } from '~/hiring/components/SaveStatusIndicator'
import { DocEditor } from '~/components/doc'
import { PresenceProvider } from '~/components/collab/PresenceProvider'
import { PresenceBar } from '~/components/collab/PresenceBar'
import { getEducationEngagement } from '~/education/lib/engagement.server'
import { EducationEngagementPanel } from '~/education/components/EducationEngagementPanel'
import { Radio } from '~/components/ui/Radio'
import { Tooltip, InfoTip } from "~/components/ui/floating";
import type { Question, RubricCriterion } from '~/types'

export const meta: Route.MetaFunction = ({ data }) => {
  const user = data?.application?.user
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  return [{ title: `${name || 'Application'} · Reviews · DALI OS` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirectToLogin(request)

  const applicationBase = await prisma.application.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      user: true,
      applicationFormVersion: true,
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
    throw redirectToLogin(request)

  const confRedirect = await requirePageSignedOrRedirect(
    auth.user.sub,
    applicationBase.applicationCycleId,
    request,
  )
  if (confRedirect) return confRedirect

  // recents visit is recorded after the blind-review pass below, so anonymized
  // applicants land in recents under their "Applicant N" pseudonym, not a name.

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
        domainId: { in: reviewerDomainIds },
      },
      include: {
        challengeFormVersion: { select: { questions: true, intro: true, form: { select: { name: true } } } },
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

  // Blind review: hide applicant identity behind a stable pseudonym while this
  // applicant is still under review (anonymizeReview on, and no
  // released decision on the reviewer's assigned domain application). The
  // pseudonym flows through the H1, page <title>, and recents because
  // they all render `${firstName} ${lastName}`. Capture the real user id first —
  // education engagement below still keys off it, server-side.
  const applicantUserId = applicationBase.user.id
  const cycle = applicationBase.applicationCycle
  if (cycle.anonymizeReview) {
    const daIds = domainApplications.map((d) => d.id)
    const released = await releasedDaIds(daIds)
    const blinded = daIds.length === 0 || daIds.some((id) => !released.has(id))
    if (blinded) {
      const labelMap = await anonLabelMapForCycle(applicationBase.applicationCycleId)
      applicationBase.user = blindUser(
        applicationBase.user,
        labelMap.get(applicationBase.id) ?? anonLabel(1),
      )
    }
  }

  // After the cycle-access + confidentiality gates — the application the reviewer
  // can open lands in their recents, keyed to the applicant's (possibly blinded)
  // name.
  recordRouteVisit(
    auth.user.sub,
    `/hiring/reviewer/application/${params.id}`,
    `${applicationBase.user.firstName} ${applicationBase.user.lastName}`.trim(),
    request,
  )

  // Helper: resolve a domainApplication's effective Domain.
  function daDomain(da: (typeof domainApplications)[number]) {
    return da.domain ?? null
  }
  function daDomainId(da: (typeof domainApplications)[number]): string | null {
    return da.domainId ?? null
  }

  // Presign file-type answers so the viewer can render real download links
  // instead of raw S3 keys. The application's "general" questions live on
  // applicationFormVersion; per-domain entries carry challenge content only
  // on cycles with challenges.
  const generalQuestionsForPresign =
    (applicationBase.applicationFormVersion?.questions as unknown as Question[]) ?? []
  const presignedGeneralAnswers = await presignAnswers(
    generalQuestionsForPresign,
    applicationBase.answers as Record<string, string>,
  )
  const presignedDomainApplications = await Promise.all(
    domainApplications.map(async (da: any) => {
      // Per-domain challenge: synthesize the viewer shape {questions, description}
      // from the bound Drive Form version.
      const challengeVersion = da.challengeFormVersion
        ? {
            questions: da.challengeFormVersion.questions,
            description: ensureBlocks(safeParseJsonString(da.challengeFormVersion.intro)),
            domain: da.domain ?? { name: "Domain" },
            challenge: { name: da.challengeFormVersion.form?.name ?? "Challenge" },
          }
        : null
      const questions = (da.challengeFormVersion?.questions ?? []) as Question[]
      return {
        ...da,
        challengeVersion,
        answers: await presignAnswers(questions, da.answers as Record<string, string>),
      }
    }),
  )

  const application = {
    ...applicationBase,
    answers: presignedGeneralAnswers,
    // The viewer renders `generalChallengeVersion` {questions, description};
    // synthesize it from the bound Drive Form version (intro → description).
    generalChallengeVersion: applicationBase.applicationFormVersion
      ? {
          id: applicationBase.applicationFormVersion.id,
          questions: applicationBase.applicationFormVersion.questions,
          description: ensureBlocks(
            safeParseJsonString(applicationBase.applicationFormVersion.intro),
          ),
        }
      : null,
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
  const educationEngagement = await getEducationEngagement(applicantUserId)

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
  if (!auth.ok) return redirectToLogin(request)

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
            application: { select: { applicationCycleId: true, applicationCycle: { select: { hasChallenges: true } } } },
          },
        },
      },
    })

    if (existing) {
      // Pin the rubric version these score keys belong to, so a later rubric
      // edit (which mints new crit-<ts> keys) doesn't orphan them at render
      // time. Prefer the per-domain rubric; fall back to the cycle-level
      // general rubric (Fellowship, which has no per-domain).
      const da = existing.domainApplication
      const domainId = da.domainId ?? null
      let rubricVersionId: string | null = existing.rubricVersionId ?? null
      if (domainId && da.application.applicationCycle.hasChallenges) {
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
  const { pageTitle, bodyText, panel, popover, sectionTitle, heading, headingIcon } = useOsChrome()

  const cycle = application.applicationCycle
  const formQuestions = (application.applicationFormVersion?.questions as unknown as Question[]) ?? []

  // Collect all rubric criteria: general form rubric + per-domain-application
  // rubrics. A domain rubric scores the challenge, so it's skipped without one.
  const allCriteria: { sectionLabel: string; criteria: RubricCriterion[] }[] = []
  const generalRubricVersion = cycle.generalRubricVersion
  if (generalRubricVersion) {
    const criteria = generalRubricVersion.criteria as unknown as RubricCriterion[]
    if (criteria.length > 0) allCriteria.push({ sectionLabel: 'General Application', criteria })
  }
  for (const da of cycle.hasChallenges ? application.domainApplications : []) {
    const dDomainId = (da as any).domainId ?? null
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
    const qs = ((da as any).challengeVersion?.questions as unknown as Question[] | undefined) ?? []
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
    <div className="flex flex-col gap-6 pb-12 relative">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className={pageTitle}>
            {application.user.firstName} {application.user.lastName}
          </h1>
          <p className={bodyText}>Review · {cycle.name}</p>
        </div>
        <PresenceBar />
      </header>

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

        {/* Right: Review Form. Pinned beside the application on wide screens,
            scrolling on its own when it's taller than the window, so only the
            application scrolls with the page. */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
          <div className={panel}>
            <div className="px-6 pt-5 flex items-center justify-between gap-3">
              <h2 className={sectionTitle}>Your review</h2>
              {!isSubmitted && (
                <SaveStatusIndicator saving={isSaving} lastSaved={lastSaved} />
              )}
            </div>
            <div className="px-6 pb-6 pt-4 space-y-6">

              {/* Scoring */}
              <div>
                <h3 className={cn(heading, "mb-4")}>Scoring</h3>
                {flatCriteria.length === 0 ? (
                  <p className="text-sm text-os-grey">No rubric attached to this application.</p>
                ) : (
                  <div className="space-y-6">
                    {allCriteria.map((section) => (
                      <div key={section.sectionLabel}>
                        {allCriteria.length > 1 && (
                          <p className="text-xs text-os-grey mb-3">{section.sectionLabel}</p>
                        )}
                        <div className="space-y-4">
                          {section.criteria.map((criterion) => (
                            <div key={criterion.key}>
                              <div className="flex justify-between items-center mb-1">
                                <label className="text-sm font-medium text-foreground">{criterion.label}</label>
                                <span className="text-xs font-semibold tabular-nums text-os-accent bg-os-accent/15 px-2 py-0.5 rounded-full">
                                  {scores[criterion.key] ?? 0} / {criterion.maxScore}
                                </span>
                              </div>
                              {criterion.description && (
                                <p className="text-xs text-os-grey mb-1">{criterion.description}</p>
                              )}
                              <input
                                type="range" min="0" max={criterion.maxScore}
                                value={scores[criterion.key] ?? 0}
                                onChange={(e) => setScores((prev) => ({ ...prev, [criterion.key]: parseInt(e.target.value) }))}
                                // The track is painted here, not left to the
                                // browser: accent up to the score, then a
                                // visible gray, so it reads in both themes.
                                style={{
                                  background: `linear-gradient(to right, var(--color-os-accent) ${((scores[criterion.key] ?? 0) / criterion.maxScore) * 100}%, var(--color-os-container-hi) ${((scores[criterion.key] ?? 0) / criterion.maxScore) * 100}%)`,
                                }}
                                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-[var(--color-os-accent)]"
                              />
                              <div className="flex justify-between text-xs text-os-grey mt-1"><span>0</span><span>{criterion.maxScore}</span></div>
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
                <h3 className={cn(heading, "mb-2")}>Internal feedback</h3>
                <p className="text-xs text-os-grey mb-2">For other reviewers. The applicant never sees this.</p>
                {existingReview && collabToken ? (
                  <DocEditor
                    features="notes"
                    density="compact"
                    editable={!isSubmitted}
                    placeholder="Strengths, weaknesses, areas to probe in interview..."
                    className={`rounded-lg border ${
                      isSubmitted
                        ? 'border-transparent bg-os-well opacity-75'
                        : 'border-transparent bg-os-well focus-within:ring-2 focus-within:ring-os-accent/40'
                    }`}
                    collab={{
                      documentName: `review:${existingReview.id}:feedback`,
                      token: collabToken,
                      userName,
                      userId: currentUserId,
                    }}
                  />
                ) : (
                  <textarea
                    rows={4}
                    disabled
                    className="block w-full rounded-os-item border-0 sm:text-sm p-2 text-foreground bg-os-well"
                    placeholder="Save the review first to enable collaborative editing..."
                  />
                )}
              </div>

              {/* Rejection Rationale — collaborative editor */}
              <div>
                <h3 className={cn(heading, "mb-2")}>
                  Rejection rationale <span className="font-normal normal-case tracking-normal">(optional)</span>
                </h3>
                {existingReview && collabToken ? (
                  <DocEditor
                    features="notes"
                    density="compact"
                    editable={!isSubmitted}
                    placeholder="If we reject this candidate, what feedback should we provide?"
                    className={`rounded-lg border ${
                      isSubmitted
                        ? 'border-transparent bg-os-well opacity-75'
                        : 'border-transparent bg-os-well focus-within:ring-2 focus-within:ring-os-accent/40'
                    }`}
                    collab={{
                      documentName: `review:${existingReview.id}:rejectionRationale`,
                      token: collabToken,
                      userName,
                      userId: currentUserId,
                    }}
                  />
                ) : (
                  <textarea
                    rows={3}
                    disabled
                    className="block w-full rounded-os-item border-0 sm:text-sm p-2 text-foreground bg-os-well"
                    placeholder="Save the review first to enable collaborative editing..."
                  />
                )}
              </div>

              {/* Overall Recommendation */}
              <div className="pt-4 border-t border-os-container">
                <h3 className={cn(heading, "mb-3")}>
                  Overall recommendation
                  <InfoTip content="Your overall hiring signal. Strong Hire means bring them in, Strong No Hire means a clear pass. Used in delibs to compare reviewers." />
                </h3>
                <div className="space-y-2">
                  {RECOMMENDATIONS.map((rec) => (
                    <Radio
                      key={rec}
                      name="recommendation"
                      value={rec}
                      checked={overallRecommendation === rec}
                      onChange={() => setOverallRecommendation(rec)}
                      label={rec}
                      className={`p-3 rounded-os-item transition-colors ${overallRecommendation === rec ? 'bg-os-accent/15 text-foreground' : 'bg-os-well hover:bg-os-container'}`}
                    />
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
                        className={buttonClasses('primary', 'md', 'w-full')}
                      >
                        Submit review
                      </button>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 py-3 rounded-os-item bg-os-well">
                      <Check className="w-4 h-4 text-os-accent" />
                      <span className="text-sm font-medium text-foreground">Review submitted</span>
                    </div>
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/hiring/reviews/${existingReview.id}/unsubmit`, {
                          method: 'POST', credentials: 'include',
                        })
                        if (res.ok) window.location.reload()
                      }}
                      className={buttonClasses('secondary', 'md', 'w-full')}
                    >
                      Unsubmit and edit
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
        <Tooltip content="Scoring guide" placement="left">
          <button
            onClick={() => setShowRubric(!showRubric)}
            aria-label="Scoring guide"
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${showRubric ? 'bg-os-accent text-os-bg' : 'bg-os-card text-os-accent hover:bg-os-container'}`}
          >
            {showRubric ? <X className="w-6 h-6" /> : <HelpCircle className="w-6 h-6" />}
          </button>
        </Tooltip>
      </div>

      {showRubric && (
        <div className={cn(popover, "fixed bottom-20 right-4 sm:bottom-24 sm:right-8 w-80 max-w-[calc(100vw-2rem)] overflow-hidden z-50")}>
          <div className="px-4 pt-4 pb-2">
            <h3 className={heading}><HelpCircle className={headingIcon} />Scoring guide</h3>
          </div>
          <ul className="divide-y divide-os-container max-h-[50vh] overflow-y-auto">
            {flatCriteria.length === 0 ? (
              <li className="p-4 text-sm text-os-grey">No rubric attached.</li>
            ) : flatCriteria.map((c) => (
              <li key={c.key} className="p-4">
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-foreground">{c.label}</h4>
                  <span className="text-xs font-semibold tabular-nums text-os-accent bg-os-accent/15 px-2 py-0.5 rounded-full">Max {c.maxScore}</span>
                </div>
                {c.description && <p className="text-xs text-os-grey">{c.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
    </PresenceProvider>
  )
}
