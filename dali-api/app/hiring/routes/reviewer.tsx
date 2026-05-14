import React, { useState, useEffect, useCallback } from 'react'
import { Link, useLoaderData } from 'react-router'
import {
  ChevronRight,
  ChevronDown,
  CheckCircle,
  FileText,
  CalendarDays,
  Video,
  EyeOff,
  ListOrdered,
} from 'lucide-react'
import { getReviewStatus } from '~/hiring/lib/review-status'
import { getActiveCycle, cycleStatusToStage, inferUnderReviewStage } from '~/hiring/lib/cycles'
import { getCycleConfidentialityState } from '~/hiring/lib/confidentiality'
import { ConfidentialityGate } from '~/hiring/components/ConfidentialityGate'
import { INITIAL_COLUMNS, FINAL_COLUMNS } from '~/hiring/lib/delibs'
import CalendarGrid from '~/hiring/components/CalendarGrid'
import { getZonedYMD } from '~/lib/timezone'

/** Convert a UTC ISO timestamp to a local-time Date at midnight on the calendar
 * day that the timestamp falls on in `timezone`. The CalendarGrid's date math
 * runs in the browser's local time, so feeding it raw UTC midnight pushes the
 * grid back a day in any timezone west of UTC. */
function isoToLocalMidnightInTz(iso: string, timezone: string): Date {
  const { year, month, day } = getZonedYMD(new Date(iso), timezone)
  return new Date(year, month - 1, day)
}
import { prisma } from '~/lib/db'
import { requireAuth } from "~/lib/auth";
import { inReviewPipelineFilter } from '~/hiring/lib/application-pipeline-filter'
import type { Route } from './+types/reviewer'

export const meta: Route.MetaFunction = () => [{ title: "Reviewer · DALI OS" }]

export async function loader({ request }: Route.LoaderArgs) {
  const empty = {
    activeCycle: null as { id: string; name: string } | null,
    currentStage: 'challengeSetup' as ReturnType<typeof cycleStatusToStage>,
    reviewerUserId: null as string | null,
    memberId: null as string | null,
    myReviews: [] as any[],
    isCycleInterviewer: false,
    needsAvailabilityPrompt: false,
    delibsSessions: [] as any[],
    delibsApplications: [] as any[],
    confidentialityRequired: null as null | "no_agreement" | "unsigned",
  }

  const auth = await requireAuth(request)
  if (!auth.ok) return empty

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } })
  if (!member) return { ...empty, reviewerUserId: auth.user.sub }

  // Anchor on the single active cycle (invariant: at most one cycle is in
  // Open/UnderReview at a time). Older code here picked "most recent cycle
  // that ever had an Open/UnderReview status update", which matched completed
  // cycles that had historically passed through UnderReview.
  const active = await getActiveCycle()
  if (!active) return { ...empty, reviewerUserId: auth.user.sub }

  // Fetch all CycleReviewer records for this member in this cycle (may span multiple domains)
  const myReviewerIds = await prisma.cycleReviewer.findMany({
    where: { daliMemberId: member.id, applicationCycleId: active.id },
    select: { id: true, domainId: true },
  })
  if (myReviewerIds.length === 0) return { ...empty, reviewerUserId: auth.user.sub }
  const reviewerIds = myReviewerIds.map(r => r.id)
  const myDomainIds = Array.from(new Set(myReviewerIds.map(r => r.domainId)))

  const activeCycleStatus = active.currentStatus

  const confState = await getCycleConfidentialityState(auth.user.sub, active.id)
  const confidentialityRequired =
    confState.status === "signed" ? null : confState.status

  // Only load applicant names when the user has signed the cycle's
  // confidentiality agreement. Otherwise return empty arrays and surface a
  // gate placeholder in the component.
  // Withdrawn applications stay in the DB (audit log) but should drop out of
  // the active reviewer queue. Filter the parent `application` relation so the
  // ApplicationReview rows themselves remain queryable from analytics paths.
  const myReviews = confidentialityRequired ? [] : await prisma.applicationReview.findMany({
    where: {
      cycleReviewerId: { in: reviewerIds },
      domainApplication: { application: inReviewPipelineFilter },
    },
    include: {
      domainApplication: {
        include: {
          application: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
          challengeVersion: { include: { domain: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Infer the sub-stage within UnderReview from actual data
  let currentStage = cycleStatusToStage(activeCycleStatus);
  if (activeCycleStatus === 'UnderReview') {
    currentStage = await inferUnderReviewStage(active.id, member.id, reviewerIds);
  }

  // Check if this member is a cycle interviewer with no availability set yet
  // (so we can prompt them once interview config is set up).
  const cycleInterviewers = await prisma.cycleInterviewer.findMany({
    where: { daliMemberId: member.id, applicationCycleId: active.id },
    select: { id: true },
  });
  const isCycleInterviewer = cycleInterviewers.length > 0;
  let needsAvailabilityPrompt = false;
  if (isCycleInterviewer) {
    const [hasInterviewConfig, availabilityCount] = await Promise.all([
      prisma.interviewConfig.findUnique({ where: { applicationCycleId: active.id } }),
      prisma.interviewerAvailability.count({
        where: { cycleInterviewerId: { in: cycleInterviewers.map(ci => ci.id) } },
      }),
    ]);
    needsAvailabilityPrompt = !!hasInterviewConfig && availabilityCount === 0;
  }

  // Fetch active delibs sessions for the reviewer's domains (live mirror view).
  // Only load when signed — the session cards show applicant names.
  // Initial sessions are blinded; Final sessions show real names.
  if (confidentialityRequired) {
    return {
      activeCycle: { id: active.id, name: active.name },
      currentStage,
      reviewerUserId: auth.user.sub,
      memberId: member.id,
      myReviews: [],
      isCycleInterviewer,
      needsAvailabilityPrompt,
      delibsSessions: [],
      delibsApplications: [],
      confidentialityRequired,
    }
  }

  const delibsSessionsRaw = await prisma.delibsSession.findMany({
    where: {
      applicationCycleId: active.id,
      domainId: { in: myDomainIds },
      status: "Active",
    },
    include: { domain: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  // For each session, compute the effective columnOrder the way the domain-lead
  // kanban does: read the saved columnOrder, then fill the default column with
  // every qualifying domain application that isn't already placed. Otherwise
  // apps that have never been dragged wouldn't appear in the reviewer mirror.
  const delibsSessions: any[] = [];
  const hydratedDaIds = new Set<string>();
  const daIdToSummary = new Map<string, any>();

  for (const session of delibsSessionsRaw) {
    const isInitial = session.type === "Initial";
    const cols = isInitial ? INITIAL_COLUMNS : FINAL_COLUMNS;
    const defaultCol = cols[0];

    const qualifyingFilter = isInitial
      ? {
          reviews: { every: { submittedAt: { not: null } }, some: {} },
          decisions: { none: { stage: { in: ["Final" as const, "Released" as const] } } },
        }
      : {
          interviews: { some: { status: "Completed" as const } },
        };

    const qualifying = await prisma.domainApplication.findMany({
      where: {
        selected: true,
        challengeVersion: { domainId: session.domainId },
        application: {
          applicationCycleId: session.applicationCycleId,
          ...inReviewPipelineFilter,
        },
        ...qualifyingFilter,
      },
      include: {
        application: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    const qualifyingIds = new Set(qualifying.map(q => q.id));
    for (const da of qualifying) {
      hydratedDaIds.add(da.id);
      daIdToSummary.set(da.id, da);
    }

    const saved = (session.columnOrder ?? {}) as Record<string, string[]>;
    const placed = new Set<string>();
    const effective: Record<string, string[]> = {};
    for (const col of cols) {
      effective[col] = [];
      for (const id of saved[col] ?? []) {
        if (qualifyingIds.has(id) && !placed.has(id)) {
          effective[col].push(id);
          placed.add(id);
        }
      }
    }
    for (const da of qualifying) {
      if (!placed.has(da.id)) effective[defaultCol].push(da.id);
    }

    delibsSessions.push({ ...session, columnOrder: effective });
  }

  const delibsApplications = Array.from(hydratedDaIds).map(id => daIdToSummary.get(id));

  return {
      activeCycle: { id: active.id, name: active.name },
      currentStage,
      reviewerUserId: auth.user.sub,
      memberId: member.id,
      myReviews,
      isCycleInterviewer,
      needsAvailabilityPrompt,
      delibsSessions,
      delibsApplications,
      confidentialityRequired: null as null | "no_agreement" | "unsigned",
    }
}

export default function ReviewerDashboard() {
  const {
    activeCycle,
    currentStage,
    myReviews,
    isCycleInterviewer,
    needsAvailabilityPrompt,
    delibsSessions,
    delibsApplications,
    confidentialityRequired,
  } = useLoaderData<typeof loader>()

  if (!activeCycle) {
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold text-foreground">Reviewer Dashboard</h1>
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <p className="text-muted-foreground">You are not assigned as a reviewer for any active cycle.</p>
        </div>
      </div>
    )
  }

  // Bucket reviews via the shared status helper so this view and the
  // domain-lead pills agree on what counts as "in progress" vs "not started".
  const reviews = myReviews ?? []
  const submittedReviews = reviews.filter(r => getReviewStatus(r) === 'submitted')
  const inProgressReviews = reviews.filter(r => getReviewStatus(r) === 'inProgress')
  const pendingReviews = reviews.filter(r => getReviewStatus(r) === 'notStarted')

  // Lookup table of every domainApplication referenced in an active delibs
  // session, so we can render per-column cards from columnOrder.
  const delibsAppMap = new Map<string, any>()
  for (const da of delibsApplications ?? []) {
    delibsAppMap.set(da.id, da)
  }

  const [scheduledInterviews, setScheduledInterviews] = useState<any[]>([])
  // Interview Availability State (API-connected)
  const [savedAvailability, setSavedAvailability] = useState<{ startTime: string; endTime: string }[]>([])
  const [interviewBlocks, setInterviewBlocks] = useState<{ startTime: string; endTime: string }[]>([])
  const [availabilitySaving, setAvailabilitySaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [pendingPrefill, setPendingPrefill] = useState<{ startTime: string; endTime: string }[] | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [interviewConfig, setInterviewConfig] = useState<{
    dayStartHour: number; dayEndHour: number;
    interviewStartDate: string; interviewEndDate: string;
    timezone: string;
  } | null>(null)

  useEffect(() => {
    if (!isCycleInterviewer) return
    // Fetch interview config for the cycle
    fetch(`/api/hiring/cycles/${activeCycle.id}/interview-config`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setInterviewConfig(data) })
      .catch(() => {})
    // Fetch saved availability
    fetch(`/api/hiring/cycles/${activeCycle.id}/my-availability`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(blocks => setSavedAvailability(blocks))
      .catch(() => {})
  }, [isCycleInterviewer, activeCycle?.id])

  // Fetch scheduled interviews (single call populates both the calendar overlay
  // and the Assigned Interviews section).
  useEffect(() => {
    if (!activeCycle) return
    fetch(`/api/hiring/cycles/${activeCycle.id}/my-interviews`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((assignments: any[]) => {
        setScheduledInterviews(assignments)
        setInterviewBlocks(
          assignments.map((a: any) => ({
            startTime: a.interview.startTime,
            endTime: a.interview.endTime,
          }))
        )
      })
      .catch(() => {})
  }, [activeCycle?.id])

  const handleSaveAvailability = useCallback(
    async (blocks: { startTime: string; endTime: string }[]) => {
      setAvailabilitySaving(true)
      try {
        const res = await fetch(`/api/hiring/cycles/${activeCycle.id}/my-availability`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks }),
        })
        if (res.ok) {
          const updated = await res.json()
          setSavedAvailability(updated)
          setPendingPrefill(null)
        }
      } finally {
        setAvailabilitySaving(false)
      }
    },
    [activeCycle.id],
  )

  // Import availability from Google Calendar:
  // fetches busy events for the cycle's date range, then computes the inverse
  // (working hours minus busy times) as the user's "available" blocks.
  const handleImportFromGoogle = useCallback(async () => {
    if (!interviewConfig) return
    setImporting(true)
    setImportError(null)
    try {
      const start = new Date(interviewConfig.interviewStartDate)
      const end = new Date(interviewConfig.interviewEndDate)
      const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })
      const res = await fetch(`/api/google-calendar/busy?${params}`, { credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setImportError(err.error ?? 'Failed to fetch Google Calendar. Please make sure you signed in with Google.')
        return
      }
      const busyEvents: { start: string; end: string }[] = await res.json()

      // Compute available blocks: enumerate every 15-min block within working
      // hours on weekdays in the range, skip any that overlap a busy event.
      const BLOCK_MS = 15 * 60 * 1000
      const available: { startTime: string; endTime: string }[] = []
      const cursor = new Date(start)
      cursor.setHours(0, 0, 0, 0)
      while (cursor <= end) {
        const day = cursor.getDay()
        if (day !== 0 && day !== 6) {
          for (let h = interviewConfig.dayStartHour; h < interviewConfig.dayEndHour; h++) {
            for (let m = 0; m < 60; m += 15) {
              const blockStart = new Date(cursor)
              blockStart.setHours(h, m, 0, 0)
              const blockEnd = new Date(blockStart.getTime() + BLOCK_MS)
              if (blockStart < start || blockEnd > end) continue
              const overlaps = busyEvents.some(b => {
                const bs = new Date(b.start)
                const be = new Date(b.end)
                return bs < blockEnd && be > blockStart
              })
              if (!overlaps) {
                available.push({
                  startTime: blockStart.toISOString(),
                  endTime: blockEnd.toISOString(),
                })
              }
            }
          }
        }
        cursor.setDate(cursor.getDate() + 1)
      }

      setPendingPrefill(available)
    } catch (err: any) {
      setImportError(err.message ?? 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [interviewConfig])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Reviewer Dashboard
        </h1>
        <p className="mt-1 text-muted-foreground">
          Manage your hiring responsibilities.
        </p>
      </div>

      <Section
        title="Assigned Written Applications"
        icon={<FileText className="w-4 h-4 text-blue-600" />}
        badge={
          !confidentialityRequired && reviews.length > 0 ? (
            <span className="text-xs font-medium text-gray-500">
              {submittedReviews.length}/{reviews.length} submitted
            </span>
          ) : null
        }
      >
        {confidentialityRequired ? (
          <ConfidentialityGate
            cycleId={activeCycle.id}
            reason={confidentialityRequired}
            next="/hiring/reviewer"
          />
        ) : reviews.length === 0 ? (
          <p className="text-sm text-gray-500">
            You don't have any assigned applications yet. You'll see them here
            once your Domain Lead assigns reviewers.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex flex-col gap-3 min-h-[300px]">
              <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-2">
                <h3 className="font-bold text-gray-700">Pending</h3>
                <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm text-gray-600">
                  {pendingReviews.length}
                </span>
              </div>
              {pendingReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="pending" />
              ))}
              {pendingReviews.length === 0 && (
                <div className="py-6 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                  <p className="text-sm text-gray-500 italic">No pending reviews</p>
                </div>
              )}
            </div>

            <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-4 flex flex-col gap-3 min-h-[300px]">
              <div className="flex items-center justify-between border-b border-blue-200 pb-2 mb-2">
                <h3 className="font-bold text-blue-800">In Progress</h3>
                <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border border-blue-200 shadow-sm text-blue-700">
                  {inProgressReviews.length}
                </span>
              </div>
              {inProgressReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="inProgress" />
              ))}
              {inProgressReviews.length === 0 && (
                <div className="py-6 text-center border-2 border-dashed border-blue-200 rounded-lg bg-white/50">
                  <p className="text-sm text-blue-400 italic">None in progress</p>
                </div>
              )}
            </div>

            <div className="bg-green-50/50 rounded-xl border border-green-100 p-4 flex flex-col gap-3 min-h-[300px]">
              <div className="flex items-center justify-between border-b border-green-200 pb-2 mb-2">
                <h3 className="font-bold text-green-800">Submitted</h3>
                <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border border-green-200 shadow-sm text-green-700">
                  {submittedReviews.length}
                </span>
              </div>
              {submittedReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="submitted" />
              ))}
              {submittedReviews.length === 0 && (
                <div className="py-6 text-center border-2 border-dashed border-green-200 rounded-lg bg-white/50">
                  <p className="text-sm text-green-500 italic">No submitted reviews</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Section>

      {isCycleInterviewer && (
        <Section
          title="Interview Availability"
          icon={<CalendarDays className="w-4 h-4 text-blue-600" />}
          badge={
            needsAvailabilityPrompt ? (
              <span className="text-xs font-medium text-accent-coral">
                Action needed
              </span>
            ) : savedAvailability.length > 0 ? (
              <span className="text-xs font-medium text-green-700">
                {savedAvailability.length} blocks saved
              </span>
            ) : null
          }
        >
          {interviewConfig ? (
            <div className="space-y-3">
              {importError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  {importError}
                </div>
              )}
              <p className="text-sm text-gray-500">
                Click or drag to select the times you are available to conduct
                interviews. 15-minute blocks.
              </p>
              <CalendarGrid
                rangeStart={isoToLocalMidnightInTz(interviewConfig.interviewStartDate, interviewConfig.timezone)}
                rangeEnd={isoToLocalMidnightInTz(interviewConfig.interviewEndDate, interviewConfig.timezone)}
                dayStartHour={interviewConfig.dayStartHour}
                dayEndHour={interviewConfig.dayEndHour}
                savedBlocks={savedAvailability}
                interviewBlocks={interviewBlocks}
                onSave={handleSaveAvailability}
                saving={availabilitySaving}
                onImportFromGoogle={handleImportFromGoogle}
                importing={importing}
                pendingPrefill={pendingPrefill}
              />
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Interview dates have not been configured yet. You'll be able to
              set your availability once your Hiring Lead configures the
              interview window.
            </p>
          )}
        </Section>
      )}

      {isCycleInterviewer && (
        <Section
          title="Assigned Interviews"
          icon={<Video className="w-4 h-4 text-blue-600" />}
          badge={
            scheduledInterviews.length > 0 ? (
              <span className="text-xs font-medium text-gray-500">
                {scheduledInterviews.length} scheduled
              </span>
            ) : null
          }
        >
          {scheduledInterviews.length === 0 ? (
            <p className="text-sm text-gray-500">
              No interviews have been scheduled with you yet. Once applicants book
              interviews on your availability, they'll appear here.
            </p>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {scheduledInterviews.map((assignment: any) => {
              const interview = assignment.interview
              if (!interview) return null
              const startDate = new Date(interview.startTime)
              const endDate = new Date(interview.endTime)
              const applicant = interview.application?.user
              const domains = interview.application?.domainApplications
                ?.map((da: any) => da.challengeVersion?.domain?.name)
                .filter(Boolean)
                .join(', ')

              return (
                <div
                  key={assignment.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col"
                >
                  <div className="p-6 border-b border-gray-200 bg-gray-50 flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 mb-1">
                        {applicant ? `${applicant.firstName} ${applicant.lastName}` : 'Applicant'}
                      </h3>
                      {domains && (
                        <p className="text-xs text-gray-500">{domains}</p>
                      )}
                      <Link
                        to={`/hiring/reviewer/application/${interview.applicationId}`}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center mt-1"
                      >
                        View Application{' '}
                        <ChevronRight className="w-3 h-3 ml-0.5" />
                      </Link>
                    </div>
                    <div className="text-right bg-white px-3 py-2 rounded-lg border shadow-sm">
                      <p className="text-sm font-bold text-gray-900">
                        {startDate.toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <p className="text-sm text-gray-500">
                        {startDate.toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        -{' '}
                        {endDate.toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="p-6 flex-1 flex flex-col justify-end">
                    <Link
                      to={`/hiring/interviewer/interview/${interview.id}`}
                      className="inline-flex items-center justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      <Video className="w-4 h-4 mr-2" />
                      Open Interview
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
          )}
        </Section>
      )}

      <Section
        title="Delibs View"
        icon={<ListOrdered className="w-4 h-4 text-blue-600" />}
        badge={
          !confidentialityRequired && (delibsSessions?.length ?? 0) > 0 ? (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex items-center">
              <EyeOff className="w-3 h-3 mr-1" />
              Live · Read-only
            </span>
          ) : null
        }
      >
        {confidentialityRequired ? (
          <ConfidentialityGate
            cycleId={activeCycle.id}
            reason={confidentialityRequired}
            next="/hiring/reviewer"
          />
        ) : (delibsSessions?.length ?? 0) === 0 ? (
          <p className="text-sm text-gray-500">
            No active deliberations. Once your Domain Lead opens a delibs
            session, you'll see a live, read-only view of the buckets here.
          </p>
        ) : (
          <div className="space-y-8">
            {(delibsSessions as any[]).map((session: any) => (
              <DelibsSessionView
                key={session.id}
                session={session}
                appMap={delibsAppMap}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({
  title,
  icon,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
          {icon}
          {title}
        </span>
        <div className="flex items-center gap-3">
          {badge}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {open && <div className="p-5 border-t border-gray-200">{children}</div>}
    </div>
  )
}

const INITIAL_COLUMN_STYLES: Record<string, { label: string; classes: string; heading: string }> = {
  'No Decision': {
    label: 'No Decision',
    classes: 'border-gray-200 bg-gray-50',
    heading: 'text-gray-700',
  },
  Interview: {
    label: 'Interview',
    classes: 'border-green-200 bg-green-50/50',
    heading: 'text-green-900',
  },
  Reject: {
    label: 'Reject',
    classes: 'border-red-200 bg-red-50/50',
    heading: 'text-red-900',
  },
}

const FINAL_COLUMN_STYLES: Record<string, { label: string; classes: string; heading: string }> = {
  Accept: {
    label: 'Accept',
    classes: 'border-green-200 bg-green-50/50',
    heading: 'text-green-900',
  },
  Waitlist: {
    label: 'Waitlist',
    classes: 'border-yellow-200 bg-yellow-50/50',
    heading: 'text-yellow-900',
  },
  Reject: {
    label: 'Reject',
    classes: 'border-red-200 bg-red-50/50',
    heading: 'text-red-900',
  },
}

function DelibsSessionView({
  session,
  appMap,
}: {
  session: any
  appMap: Map<string, any>
}) {
  const isInitial = session.type === 'Initial'
  const columnOrder = (session.columnOrder ?? {}) as Record<string, string[]>
  const columns = isInitial ? INITIAL_COLUMNS : FINAL_COLUMNS
  const styles = isInitial ? INITIAL_COLUMN_STYLES : FINAL_COLUMN_STYLES

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">
          {session.domain?.name ?? 'Domain'} · {isInitial ? 'Written Delibs' : 'Final Delibs'}
        </h3>
      </div>
      <div
        className={`grid grid-cols-1 gap-4 ${columns.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
      >
        {columns.map((col) => {
          const ids = columnOrder[col] ?? []
          const style = styles[col]
          return (
            <div key={col} className={`rounded-xl border p-4 min-h-[160px] ${style.classes}`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className={`font-bold text-sm ${style.heading}`}>{style.label}</h4>
                <span className="bg-white px-2 py-0.5 rounded-full text-xs font-bold border shadow-sm">
                  {ids.length}
                </span>
              </div>
              <div className="space-y-2">
                {ids.map((id, i) => {
                  const da = appMap.get(id)
                  const user = da?.application?.user
                  const label = user ? `${user.firstName} ${user.lastName}` : 'Applicant'
                  return (
                    <div
                      key={id}
                      className="bg-white p-3 rounded-md border border-gray-200 shadow-sm flex items-center gap-2"
                    >
                      {!isInitial && col === 'Waitlist' && (
                        <span className="text-gray-400 font-bold text-xs w-4">{i + 1}.</span>
                      )}
                      <span className="font-medium text-gray-900 text-sm">{label}</span>
                    </div>
                  )
                })}
                {ids.length === 0 && (
                  <div className="py-4 text-center border-2 border-dashed border-gray-300 rounded-md bg-white/50">
                    <p className="text-xs text-gray-500 italic">Empty</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReviewCard({ review, variant }: { review: any; variant: 'pending' | 'inProgress' | 'submitted' }) {
  const da = review.domainApplication
  const user = da?.application?.user
  const domain = da?.challengeVersion?.domain
  const appId = da?.applicationId ?? da?.application?.id

  const borderClass = variant === 'submitted'
    ? 'border-green-200'
    : variant === 'inProgress'
    ? 'border-blue-200 ring-1 ring-blue-100'
    : 'border-border'

  return (
    <div className={`bg-card p-4 rounded-lg border ${borderClass} shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex justify-between items-start mb-1">
        <h4 className="font-bold text-foreground">
          {user?.firstName ?? '?'} {user?.lastName ?? ''}
        </h4>
        {variant === 'submitted' && <CheckCircle className="w-4 h-4 text-green-500" />}
      </div>
      <p className="text-xs text-muted-foreground mb-3">{domain?.name ?? 'Unknown Domain'}</p>
      {variant === 'submitted' && review.overallRecommendation && (
        <p className="text-xs font-medium text-muted-foreground mb-3 bg-muted inline-block px-2 py-0.5 rounded">
          {review.overallRecommendation}
        </p>
      )}
      {appId && (
        <Link
          to={`/hiring/reviewer/application/${appId}`}
          className={`block w-full text-center px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            variant === 'pending'
              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              : variant === 'inProgress'
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-card border border-gray-300 text-foreground/80 hover:bg-muted/50'
          }`}
        >
          {variant === 'pending' ? 'Start Review' : variant === 'inProgress' ? 'Continue Review' : 'View Review'}
        </Link>
      )}
    </div>
  )
}