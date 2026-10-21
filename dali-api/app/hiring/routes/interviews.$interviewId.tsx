import { useState, useCallback } from 'react'
import { useLoaderData, useSearchParams } from 'react-router'
import { redirect } from 'react-router'
import { Check, Video, MapPin, Users } from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from '~/lib/login-next'
import { resolvePhotoUrl } from '~/lib/photo'
import { getCollabToken } from "~/lib/collab-token.server";
import { getPresenceUser } from '~/lib/presence-user'
import { requirePageSignedOrRedirect } from '~/hiring/lib/confidentiality'
import { presignAnswers } from '~/hiring/lib/presign'
import { ensureBlocks } from '~/collab/legacy/pm-to-blocknote'
import { safeParseJsonString } from '~/forms/lib/forms-data'
import { DocEditor, EnhanceReviewContext } from '~/components/doc'
import { interviewNotesRoomName } from '~/collab/roomName'
import { latestRecordingFor } from '~/lib/meeting-recording.server'
import { useFeatureFlag } from '~/components/FeatureFlags'
import { MeetingRecorder } from '~/components/MeetingRecorder'
import { RecordingPresencePill } from '~/components/RecordingPresencePill'
import { RecordingMount } from '~/components/meeting-recorder/RecordingMount'
import { RecordingRail } from '~/components/meeting-recorder/RecordingRail'
import { EnhanceBar } from '~/components/meeting-recorder/EnhanceBar'
import { EnhanceBlockActions } from '~/components/meeting-recorder/EnhanceBlockActions'
import { TranscriptChipHoverLayer } from '~/components/meeting-recorder/TranscriptChipHoverLayer'
import { useRecordingEditor } from '~/components/meeting-recorder/use-recording-editor'
import { PresenceProvider } from '~/components/collab/PresenceProvider'
import { PresenceBar } from '~/components/collab/PresenceBar'
import { useSharedString } from '~/components/collab/useSharedString'
import { ApplicationViewer } from '~/hiring/components/ApplicationViewer'
import { loadContinuedInterestView } from '~/hiring/lib/continued-interest.server'
import { buildCriteriaLabelMap } from '~/hiring/lib/rubric-criteria'
import type { Route } from './+types/interviews.$interviewId'
import type { Question } from '~/types'
import { INTERVIEW_STATUS_TONES } from '~/hiring/lib/labels'
import { Pill } from '~/hiring/components/cycle-setup/SetupCard'
import { Select, InfoTip } from "~/components/ui/floating";
import { useOsChrome } from '~/components/os-chrome'
import { buttonClasses } from '~/components/ui/Button'
import { cn } from '~/lib/cn'
import { getUserRoles } from '~/lib/roles'
import { isFeatureEnabled } from '~/lib/feature-flags.server'
import { applicationBlindLabel } from '~/hiring/lib/anonymization.server'
import { listPriorApplications } from '~/hiring/lib/prior-applications.server'
import { getApplicantEmailEngagement } from '~/hiring/lib/email-engagement.server'
import { getHiringEventEngagement } from '~/hiring/lib/hiring-events.server'
import { getEducationEngagement } from '~/education/lib/engagement.server'
import { EducationEngagementPanel } from '~/education/components/EducationEngagementPanel'
import { ApplicationEventsPanel } from '~/hiring/components/ApplicationEventsPanel'
import { PriorApplicationsPanel } from '~/hiring/components/PriorApplicationsPanel'
import { ApplicantEmailPanel } from '~/hiring/components/ApplicantEmailPanel'
import { ApplicantDetailHeader } from '~/hiring/components/ApplicantDetailHeader'
import { DetailCard } from '~/hiring/components/DetailCard'
import { ReviewsCard, type ReviewsCardReview } from '~/hiring/components/ReviewsCard'

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
  if (!member?.daliMember) throw redirect('/hiring?view=interviews')

  const interview = await prisma.interview.findUnique({
    where: { id: params.interviewId },
    include: {
      room: { select: { id: true, name: true } },
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
              applicationCycle: { select: { anonymizeReview: true, name: true } },
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

  if (!interview) throw redirect('/hiring?view=interviews')

  const myAssignment = interview.assignments.find(
    (a: any) => a.cycleInterviewer.userId === auth.user.sub,
  )

  if (!myAssignment) throw redirect('/hiring?view=interviews')

  const confRedirect = await requirePageSignedOrRedirect(
    auth.user.sub,
    interview.applicationCycleId,
    request,
  )
  if (confRedirect) throw confRedirect

  // Rubric criteria for the applicant's domain. DomainApplication.domainId is
  // always set, for every applicant group.
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

  const collabToken = await getCollabToken(request)

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
      continuedInterest: await loadContinuedInterestView(interview.domainApplication),
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

  // Same applicant context the review page shows. Blinding follows the
  // applicant-wide release, which is also what gates the email thread modal.
  const application = interview.domainApplication.application
  const blinded =
    (await applicationBlindLabel({
      cycleId: interview.applicationCycleId,
      applicationId: application.id,
      anonymizeReview: application.applicationCycle.anonymizeReview,
    })) != null
  const roles = await getUserRoles(auth.user.sub, request)
  const [educationEngagement, hiringEventEngagement, priorApplications, emailEngagement, latestRecordingRow] =
    await Promise.all([
      getEducationEngagement(application.userId),
      isFeatureEnabled('application-events', auth.user.sub, roles, request).then((on) =>
        on ? getHiringEventEngagement(application.userId) : [],
      ),
      listPriorApplications({
        userId: application.userId,
        currentApplicationId: application.id,
        hideOutcomes: blinded,
      }),
      getApplicantEmailEngagement(application.userId, { blinded }),
      // The notes' newest recording, so a live one shows in place of Record
      // and a finished one is picked up by whoever didn't start it.
      latestRecordingFor(interviewNotesRoomName(interview.id)),
    ])

  return {
      interview: interviewWithPresignedAnswers,
      educationEngagement,
      hiringEventEngagement,
      priorApplications,
      emailEngagement,
      blinded,
      myAssignment,
      criteriaByKey,
      collabToken,
      userName,
      currentUserId: auth.user.sub,
      presencePhotoUrl: presenceUser?.photoUrl ?? null,
      presenceSubtitle: presenceUser?.subtitle ?? null,
      isCore: roles.isCore,
      latestRecording: latestRecordingRow
        ? {
            id: latestRecordingRow.id,
            ownerName: latestRecordingRow.ownerName,
            ownerIsYou: latestRecordingRow.userId === auth.user.sub,
            status: latestRecordingRow.status,
            since: latestRecordingRow.createdAt.toISOString(),
          }
        : null,
    }
}

// Interviewers ask the applicant before recording; Start waits for a yes.
const RECORD_CONSENT = {
  title: 'Record this interview',
  ask: 'Ask the applicant for permission to record before you start. Only record if they say yes.',
  confirm: 'The applicant agreed to be recorded',
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
    educationEngagement,
    hiringEventEngagement,
    priorApplications,
    emailEngagement,
    blinded,
    isCore,
    latestRecording,
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
        continuedInterest: interview.domainApplication?.continuedInterest ?? null,
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
  const notesRoom = interviewNotesRoomName(interview.id)
  const [searchParams] = useSearchParams()
  const recordingEnabled = useFeatureFlag('ai-meeting-notes')
  const hasTranscriptParam = Boolean(searchParams.get('transcript'))
  const { editorRef, onEditorReady, hookProps: recordingEditorProps } = useRecordingEditor({
    notePath: `/hiring/interviews/${interview.id}`,
  })
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

  const { heading, formTrigger } = useOsChrome()
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(submittedReviews[0]?.id ?? null)
  const reviewCards: ReviewsCardReview[] = submittedReviews.map((review: any) => {
    const m = review.cycleReviewer?.user
    return {
      id: review.id,
      reviewerName: m?.firstName && m?.lastName ? `${m.firstName} ${m.lastName}` : m?.daliEmail ?? 'Reviewer',
      reviewerPhotoUrl: review.reviewerPhotoUrl,
      overallRecommendation: review.overallRecommendation,
      scores: review.scores,
      feedback: review.feedback,
      rejectionRationale: review.rejectionRationale,
      submittedAt: review.submittedAt,
    }
  })
  const editorClass = cn(
    'rounded-lg border border-transparent bg-os-well',
    isCompleted ? 'opacity-75' : 'focus-within:ring-2 focus-within:ring-os-accent/40',
  )
  const sessionExpired = (
    <p className="rounded-os-item bg-os-amber/10 px-3 py-2 text-sm text-os-amber">
      Session expired. Refresh to keep editing.
    </p>
  )
  const timeRange = `${startDate.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })}, ${startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} to ${endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  const prepNote = interview.domainApplication?.interviewPrepNote?.trim()

  return (
    <PresenceProvider
      pageId={`interview:${interview.id}`}
      token={collabToken}
      userName={userName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
    <div className="space-y-6 pb-12">
      <ApplicantDetailHeader
        name={applicant ? `${applicant.firstName} ${applicant.lastName}` : 'Applicant'}
        domainName={domain ?? 'Interview'}
        cycleName={application?.applicationCycle?.name ?? ''}
        statusSlot={
          <>
            <PresenceBar />
            <Pill dot={isCompleted ? 'success' : INTERVIEW_STATUS_TONES[interview.status] ?? 'neutral'}>
              {isCompleted ? 'Completed' : interview.status}
            </Pill>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ApplicationViewer
            application={viewerApplication as any}
            questionLabels={questionLabels}
            readOnly
          />
          <EducationEngagementPanel entries={educationEngagement} defaultOpen={false} />
          <ApplicationEventsPanel
            entries={hiringEventEngagement}
            currentCycleId={interview.applicationCycleId}
            defaultOpen={false}
          />
          <PriorApplicationsPanel
            entries={priorApplications}
            outcomesHidden={blinded}
            hrefFor={() => null}
            defaultOpen={false}
          />
          <ApplicantEmailPanel
            engagement={emailEngagement}
            blinded={blinded}
            applicationId={application.id}
            defaultOpen={false}
          />
        </div>

        <div className="space-y-4">
          <ReviewsCard
            reviews={reviewCards}
            criteria={criteriaByKey}
            selectedId={selectedReviewId}
            onSelect={setSelectedReviewId}
          />
        </div>
      </div>

      <DetailCard title="Interview" subtitle={timeRange}>
        <div className="flex flex-col gap-5 px-6 pb-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-os-grey">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden />
              {interview.room?.name ?? 'Online'}
            </span>
            {!interview.room && (interview.videoUrl ?? interview.zoomJoinUrl) && (
              <a
                href={interview.videoUrl ?? interview.zoomJoinUrl ?? ''}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-os-accent hover:text-os-accent-hover"
              >
                <Video className="h-4 w-4" aria-hidden />
                Join Google Meet
              </a>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4" aria-hidden />
              {coInterviewers.length > 0
                ? `With ${coInterviewers
                    .map((c: { name: string; roleLabel: string }) => `${c.name} (${c.roleLabel})`)
                    .join(', ')}`
                : 'No co-interviewer assigned'}
            </span>
          </div>

          {prepNote && (
            <div className="rounded-os-item bg-os-amber/10 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[1px] text-os-amber">Interview prep note</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{prepNote}</p>
              <p className="mt-1 text-xs text-os-grey">Set by leads during Initial delibs.</p>
            </div>
          )}

          <RecordingMount
            enabled={recordingEnabled && !!collabToken && (!isCompleted || hasTranscriptParam)}
            documentName={notesRoom}
            canEdit={!isCompleted}
            isCore={isCore}
            latestRecording={latestRecording}
            collabToken={collabToken}
            {...recordingEditorProps}
          >
            {(rec) => {
              const railOpen = Boolean(rec?.open && rec.phase !== 'idle')
              const getRoot = () => editorRef.current?.domElement ?? null
              return (
                <EnhanceReviewContext.Provider
                  value={rec ? { keepBlock: rec.keepBlock, revertBlock: rec.revertBlock, priorBlocks: rec.enhanceNotes?.priorBlocks } : null}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className={heading}>Interview notes</h3>
                      <div className="flex items-center gap-2">
                        <RecordingPresencePill documentName={notesRoom} collabToken={collabToken} />
                        {rec && <MeetingRecorder rec={rec} containerWide consent={RECORD_CONSENT} />}
                      </div>
                    </div>
                    {rec && <EnhanceBar rec={rec} />}
                    {rec && <EnhanceBlockActions rec={rec} getRoot={getRoot} />}
                    <div className={cn('grid grid-cols-1 gap-4', railOpen && 'lg:grid-cols-[minmax(0,1fr)_22rem]')}>
                      <TranscriptChipHoverLayer
                        railOpen={railOpen}
                        onChipClick={(recordingId, at) => {
                          if (!rec || rec.recordingId !== recordingId) return false
                          rec.jumpToTranscript(at)
                          return true
                        }}
                      >
                        {collabToken ? (
                          <DocEditor
                            features="notes"
                            density="compact"
                            editable={!isCompleted}
                            aiEnabled
                            onEditorReady={onEditorReady}
                            placeholder="Write your interview notes here..."
                            className={editorClass}
                            collab={{
                              documentName: notesRoom,
                              token: collabToken,
                              userName,
                              userId: currentUserId,
                            }}
                          />
                        ) : sessionExpired}
                      </TranscriptChipHoverLayer>
                      {rec && railOpen && <RecordingRail rec={rec} />}
                    </div>
                  </div>
                </EnhanceReviewContext.Provider>
              )
            }}
          </RecordingMount>

          <div className="border-t border-os-container pt-4">
            <h3 className={cn(heading, 'mb-3')}>
              Joint recommendation
              <InfoTip content="One recommendation for both interviewers. Either of you can mark it complete." />
            </h3>
            {isCompleted ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-os-item bg-os-well px-4 py-2">
                  <Check className="h-4 w-4 text-os-accent" aria-hidden />
                  <span className="text-sm font-medium text-foreground">
                    {interview.recommendation ?? recommendation}
                  </span>
                </span>
                <button onClick={handleReopen} disabled={completing} className={buttonClasses('secondary', 'md')}>
                  {completing ? 'Reopening…' : 'Reopen'}
                </button>
                {interview.recommendationNotes && (
                  <p className="w-full text-sm text-os-grey">{interview.recommendationNotes}</p>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-full sm:w-64">
                  <Select
                    value={recommendation}
                    placeholder="Select a recommendation..."
                    onChange={(v) => setRecommendation(v)}
                    options={RECOMMENDATION_OPTIONS.map((opt) => ({ value: opt, label: opt }))}
                    buttonClassName={formTrigger}
                  />
                </div>
                <button
                  onClick={handleMarkComplete}
                  disabled={!recommendation || completing}
                  className={buttonClasses('primary', 'md')}
                >
                  {completing ? 'Completing…' : 'Mark complete'}
                </button>
              </div>
            )}
          </div>
        </div>
      </DetailCard>
    </div>
    </PresenceProvider>
  )
}
