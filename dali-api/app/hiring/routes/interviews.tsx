import { useState, useEffect, useCallback } from 'react'
import { Link, useLoaderData } from 'react-router'
import { CalendarDays, Video } from 'lucide-react'
import { getUserRoles } from '~/lib/roles'
import { hiringPills } from '~/hiring/components/hiringPills'
import { AreaPillNav } from '~/components/AreaPillNav'
import { CycleSelector } from '~/hiring/components/CycleSelector'
import { Section } from '~/hiring/components/Section'
import { getActiveCycle } from '~/hiring/lib/cycles'
import CalendarGrid from '~/hiring/components/CalendarGrid'
import { zonedWallTimeUtc } from '~/lib/timezone'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import type { Route } from './+types/interviews'

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Interviews · Hiring · DALI OS" }]

// The interviewer's home: assigned interviews + availability. Split out of
// the reviewer dashboard's internal view switcher — interviewing is its own
// job with its own pill, not a tab inside Reviews.

/** The interview-window bound dates are stored as UTC-midnight stamps that
 * stand for plain calendar dates. Return a browser-local midnight Date on that
 * same calendar day so CalendarGrid's day-range gating lines up with the
 * server's window (which also reads these bounds as UTC calendar dates).
 * Reading the day in a timezone instead would shift it back a day west of UTC. */
function isoToCalendarDayLocalMidnight(iso: string): Date {
  const d = new Date(iso)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export async function loader({ request }: Route.LoaderArgs) {
  const empty = {
    activeCycle: null as { id: string; name: string; cycleType: string } | null,
    availableCycles: [] as Array<{ id: string; name: string; cycleType: string }>,
    needsAvailabilityPrompt: false,
    pillRoles: null as {
      isCore: boolean
      isDomainLead: boolean
      isAdmin: boolean
      isInterviewer: boolean
    } | null,
  }

  const auth = await requireAuth(request)
  if (!auth.ok) return empty

  const roles = await getUserRoles(auth.user.sub)
  const pillRoles = {
    isCore: roles.isCore,
    isDomainLead: roles.isDomainLead,
    isAdmin: roles.isAdmin,
    isInterviewer: roles.isInterviewer,
  }
  Object.assign(empty, { pillRoles })

  // Mirrors the reviewer dashboard's dual-cycle probing: a Standard and an
  // InternToFull cycle can be active simultaneously; collect the ones this
  // user interviews on and let ?cycle=<id> switch between them.
  const [standardActive, internToFullActive] = await Promise.all([
    getActiveCycle("Standard"),
    getActiveCycle("InternToFull"),
  ])
  const candidates = [standardActive, internToFullActive].filter(
    (c): c is NonNullable<typeof standardActive> => c !== null,
  )
  if (candidates.length === 0) return empty

  const assignmentsPerCycle = await Promise.all(
    candidates.map(async (c) => ({
      cycle: c,
      interviewerRows: await prisma.cycleInterviewer.findMany({
        where: { userId: auth.user.sub, applicationCycleId: c.id },
        select: { id: true },
      }),
    })),
  )
  const onCycles = assignmentsPerCycle.filter(({ interviewerRows }) => interviewerRows.length > 0)
  if (onCycles.length === 0) return empty

  const availableCycles = onCycles.map(({ cycle }) => ({
    id: cycle.id,
    name: cycle.name,
    cycleType: cycle.cycleType as string,
  }))

  const url = new URL(request.url)
  const requested = url.searchParams.get("cycle")
  const selectedEntry =
    (requested ? onCycles.find(({ cycle }) => cycle.id === requested) : undefined) ??
    onCycles[0]
  const active = selectedEntry.cycle

  // Prompt once interview config exists but no availability has been set.
  const [hasInterviewConfig, availabilityCount] = await Promise.all([
    prisma.interviewConfig.findUnique({ where: { applicationCycleId: active.id } }),
    prisma.interviewerAvailability.count({
      where: { cycleInterviewerId: { in: selectedEntry.interviewerRows.map((r) => r.id) } },
    }),
  ])

  return {
    activeCycle: { id: active.id, name: active.name, cycleType: active.cycleType as string },
    availableCycles,
    needsAvailabilityPrompt: !!hasInterviewConfig && availabilityCount === 0,
    pillRoles,
  }
}

export default function InterviewsDashboard() {
  const { activeCycle, availableCycles, needsAvailabilityPrompt, pillRoles } =
    useLoaderData<typeof loader>()

  const areaPills = pillRoles && (
    <AreaPillNav items={hiringPills({ ...pillRoles, active: 'interviews' })} />
  )

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
    if (!activeCycle) return
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
  }, [activeCycle?.id])

  // Fetch scheduled interviews (single call populates both the calendar overlay
  // and the Assigned Interviews section). Exposed as a callback so declining an
  // interview from a card can refresh the list in place.
  const loadScheduledInterviews = useCallback(() => {
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

  useEffect(() => {
    loadScheduledInterviews()
  }, [loadScheduledInterviews])

  // Mark unavailable for an assigned interview, straight from its card.
  // Mirrors the decline action on the interview detail page, but refreshes the
  // list in place instead of navigating away.
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const handleDeclineInterview = useCallback(
    async (interviewId: string) => {
      if (!activeCycle) return
      if (
        !confirm(
          'Are you sure you want to mark yourself as unavailable for this interview?',
        )
      )
        return
      setDecliningId(interviewId)
      try {
        const res = await fetch(
          `/api/hiring/cycles/${activeCycle.id}/my-interviews/${interviewId}/decline`,
          { method: 'POST', credentials: 'include' },
        )
        if (res.ok) {
          loadScheduledInterviews()
          return
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (res.status === 409) {
          alert(
            body.error ??
              'No replacement interviewer is available. Please contact the hiring lead.',
          )
          return
        }
        alert(`Failed to mark unavailable: ${body.error ?? res.statusText}`)
      } catch (e) {
        alert(
          `Failed to mark unavailable: ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      } finally {
        setDecliningId(null)
      }
    },
    [activeCycle?.id, loadScheduledInterviews],
  )

  const handleSaveAvailability = useCallback(
    async (blocks: { startTime: string; endTime: string }[]) => {
      if (!activeCycle) return
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
    [activeCycle?.id],
  )

  // Import availability from Google Calendar:
  // fetches busy events for the cycle's date range, then computes the inverse
  // (working hours minus busy times) as the user's "available" blocks.
  const handleImportFromGoogle = useCallback(async () => {
    if (!interviewConfig) return
    setImporting(true)
    setImportError(null)
    try {
      const tz = interviewConfig.timezone
      // The stored bounds are UTC-midnight stamps standing for calendar dates;
      // read them in UTC and walk day-by-day. Working-hour blocks are built at
      // wall-clock time in the interview timezone so they line up with the grid
      // and survive the server's window clip regardless of the browser's zone.
      const startBound = new Date(interviewConfig.interviewStartDate)
      const endBound = new Date(interviewConfig.interviewEndDate)
      const windowStart = zonedWallTimeUtc(startBound.getUTCFullYear(), startBound.getUTCMonth() + 1, startBound.getUTCDate(), 0, 0, tz)
      const windowEnd = zonedWallTimeUtc(endBound.getUTCFullYear(), endBound.getUTCMonth() + 1, endBound.getUTCDate() + 1, 0, 0, tz)
      const params = new URLSearchParams({ start: windowStart.toISOString(), end: windowEnd.toISOString() })
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
      // Iterate calendar days from the start bound through the end bound by
      // UTC date; the block instants themselves are resolved in `tz`.
      const dayCursor = new Date(Date.UTC(startBound.getUTCFullYear(), startBound.getUTCMonth(), startBound.getUTCDate()))
      const lastDay = new Date(Date.UTC(endBound.getUTCFullYear(), endBound.getUTCMonth(), endBound.getUTCDate()))
      while (dayCursor <= lastDay) {
        const y = dayCursor.getUTCFullYear()
        const mo = dayCursor.getUTCMonth() + 1
        const d = dayCursor.getUTCDate()
        // Weekday as seen in the interview timezone (skip Sat/Sun). Resolved
        // from the day's noon instant so it can't tip into an adjacent day.
        const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
          .format(zonedWallTimeUtc(y, mo, d, 12, 0, tz))
        const isWeekend = weekday === 'Sat' || weekday === 'Sun'
        if (!isWeekend) {
          for (let h = interviewConfig.dayStartHour; h < interviewConfig.dayEndHour; h++) {
            for (let m = 0; m < 60; m += 15) {
              const blockStart = zonedWallTimeUtc(y, mo, d, h, m, tz)
              const blockEnd = new Date(blockStart.getTime() + BLOCK_MS)
              if (blockStart < windowStart || blockEnd > windowEnd) continue
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
        dayCursor.setUTCDate(dayCursor.getUTCDate() + 1)
      }

      setPendingPrefill(available)
    } catch (err: any) {
      setImportError(err.message ?? 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [interviewConfig])

  if (!activeCycle) {
    return (
      <div className="space-y-8">
        {areaPills}
        <h1 className="text-2xl font-bold text-foreground">Interviews</h1>
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <p className="text-muted-foreground">You are not assigned as an interviewer for any active cycle.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {areaPills}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Interviews</h1>
          <p className="mt-1 text-muted-foreground">
            Your assigned interviews and availability.
          </p>
        </div>
        <CycleSelector cycles={availableCycles} activeId={activeCycle.id} />
      </div>

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
            const applicant = interview.domainApplication?.application?.user
            const domains = interview.domainApplication?.challengeVersion?.domain?.name

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
                <div className="p-6 flex-1 flex items-end gap-3">
                  <Link
                    to={`/hiring/interviews/${interview.id}`}
                    className="inline-flex items-center justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Open Interview
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDeclineInterview(interview.id)}
                    disabled={decliningId === interview.id}
                    className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    {decliningId === interview.id ? 'Marking…' : 'Mark Unavailable'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        )}
      </Section>

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
              rangeStart={isoToCalendarDayLocalMidnight(interviewConfig.interviewStartDate)}
              rangeEnd={isoToCalendarDayLocalMidnight(interviewConfig.interviewEndDate)}
              dayStartHour={interviewConfig.dayStartHour}
              dayEndHour={interviewConfig.dayEndHour}
              savedBlocks={savedAvailability}
              interviewBlocks={interviewBlocks}
              onSave={handleSaveAvailability}
              saving={availabilitySaving}
              timezone={interviewConfig.timezone}
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
    </div>
  )
}
