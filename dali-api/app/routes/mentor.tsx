import React, { useState, useEffect, useCallback } from 'react'
import { Link, useLoaderData } from 'react-router'
import {
  ChevronRight,
  Clock,
  CheckCircle,
  FileText,
  CalendarDays,
  Video,
  Save,
  EyeOff,
  ListOrdered,
  PlayCircle,
} from 'lucide-react'
import type { CycleStage } from '~/types'
import CalendarGrid from '~/components/CalendarGrid'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import type { Route } from './+types/mentor'

// Map DB cycle status → mentor-facing stage
function cycleStatusToStage(status: string): CycleStage {
  switch (status) {
    case 'Draft': return 'challengeSetup'
    case 'Open': return 'collectingAvailability'
    case 'Closed': return 'interviews'
    case 'DecisionsReleased': return 'finalDelibs'
    default: return 'challengeSetup'
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const empty = {
    activeCycle: null as { id: string; name: string } | null,
    currentStage: 'challengeSetup' as CycleStage,
    mentorUserId: null as string | null,
    allCycleApps: [] as any[],
  }

  const auth = await requireAuth(request)
  if (!auth.ok) return empty

  // Find the cycle this mentor is actually assigned to as a reviewer
  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } })
  if (!member) return { ...empty, mentorUserId: auth.user.sub }

  const reviewer = await prisma.cycleReviewer.findFirst({
    where: { daliMemberId: member.id },
    include: {
      applicationCycle: {
        include: {
          statusUpdates: { orderBy: { createdAt: 'desc' }, take: 1 },
          applications: {
            include: {
              user: true,
              statusUpdates: { orderBy: { createdAt: 'desc' }, take: 1 },
              domainApplications: {
                include: { challengeVersion: { include: { domain: true } } },
              },
              mentorReviews: true,
            },
          },
        },
      },
    },
    orderBy: { applicationCycle: { createdAt: 'desc' } },
  })

  if (!reviewer) return { ...empty, mentorUserId: auth.user.sub }

  const cycle = reviewer.applicationCycle
  const status = cycle.statusUpdates[0]?.newStatus ?? 'Draft'

  // Only submitted (non-draft) applications are visible to mentors.
  const allCycleApps = cycle.applications.filter((a) => {
    const latest = a.statusUpdates[0]?.newStatus
    return latest && latest !== 'Draft'
  })

  return {
    activeCycle: { id: cycle.id, name: cycle.name },
    currentStage: cycleStatusToStage(status),
    mentorUserId: auth.user.sub,
    allCycleApps,
  }
}

type LoaderData = Awaited<ReturnType<typeof loader>>
type CycleApp = LoaderData['allCycleApps'][number]

export default function MentorDashboard() {
  const { activeCycle, currentStage, mentorUserId, allCycleApps } = useLoaderData<typeof loader>()

  if (!activeCycle) {
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold text-gray-900">Mentor Dashboard</h1>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-gray-500">No active hiring cycle found.</p>
        </div>
      </div>
    )
  }

  const readingDueDate: string | null = null
  const availabilityDueDate: string | null = null

  // Reading-stage buckets derived from mentorReviews:
  //   finished   = has a review with overallRecommendation set
  //   inProgress = has a review row but no overallRecommendation yet
  //   pending    = no review row at all
  const finishedApps = allCycleApps.filter((a: CycleApp) =>
    a.mentorReviews.some((r: any) => r.mentorId === mentorUserId && r.overallRecommendation !== null),
  )
  const finishedIdSet = new Set(finishedApps.map((a: CycleApp) => a.id))
  const inProgressApps = allCycleApps.filter(
    (a: CycleApp) =>
      !finishedIdSet.has(a.id) &&
      a.mentorReviews.some((r: any) => r.mentorId === mentorUserId),
  )
  const inProgressIdSet = new Set(inProgressApps.map((a: CycleApp) => a.id))
  const pendingApps = allCycleApps.filter(
    (a: CycleApp) => !finishedIdSet.has(a.id) && !inProgressIdSet.has(a.id),
  )

  // Blinded applicant labels (A, B, C, …) for the deliberation view.
  const blindedMap = new Map<string, string>()
  allCycleApps.forEach((app: CycleApp, index: number) => {
    blindedMap.set(app.id, String.fromCharCode(65 + index))
  })

  const [scheduledInterviews, setScheduledInterviews] = useState<any[]>([])
  const [interviewNotes, setInterviewNotes] = useState<Record<string, string>>({})
  const handleSaveNotes = useCallback(async (interviewId: string) => {
    if (!activeCycle) return
    const notes = interviewNotes[interviewId]
    if (notes === undefined) return
    await fetch(`/api/cycles/${activeCycle.id}/my-interviews/${interviewId}/notes`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    })
  }, [activeCycle, interviewNotes])
  // Deliberation buckets are not yet wired to persistent state — separate feature.
  const writtenDelibsBuckets = { advance: [] as string[], cut: [] as string[] }
  const finalDelibsBuckets = { reject: [] as string[], waitlist: [] as string[], accept: [] as string[] }
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
  } | null>(null)

  useEffect(() => {
    if (currentStage !== 'collectingAvailability') return
    // Fetch interview config for the cycle
    fetch(`/api/cycles/${activeCycle.id}/interview-config`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setInterviewConfig(data) })
      .catch(() => {})
    // Fetch saved availability
    fetch(`/api/cycles/${activeCycle.id}/my-availability`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(blocks => setSavedAvailability(blocks))
      .catch(() => {})
    // Fetch booked interviews for overlay
    fetch(`/api/cycles/${activeCycle.id}/my-interviews`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((assignments: any[]) => {
        setInterviewBlocks(
          assignments.map(a => ({
            startTime: a.interview.startTime,
            endTime: a.interview.endTime,
          }))
        )
      })
      .catch(() => {})
  }, [currentStage, activeCycle.id])

  // Fetch scheduled interviews when in interviews stage
  useEffect(() => {
    if (currentStage !== 'interviews' || !activeCycle) return
    fetch(`/api/cycles/${activeCycle.id}/my-interviews`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((assignments: any[]) => {
        setScheduledInterviews(assignments)
        // Pre-populate notes from existing data
        const notesMap: Record<string, string> = {}
        for (const a of assignments) {
          if (a.notes) notesMap[a.interview.id] = a.notes
        }
        setInterviewNotes(notesMap)
      })
      .catch(() => {})
  }, [currentStage, activeCycle])

  const handleSaveAvailability = useCallback(
    async (blocks: { startTime: string; endTime: string }[]) => {
      setAvailabilitySaving(true)
      try {
        const res = await fetch(`/api/cycles/${activeCycle.id}/my-availability`, {
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
  const stageInfo = {
    challengeSetup: {
      title: 'Challenge Setup',
      desc: 'Your Domain Lead is setting up the challenge questions. Hang tight!',
      dueDate: null,
    },
    challengesReady: {
      title: 'Challenges Ready',
      desc: 'Challenges are finalized. Waiting for applications to open.',
      dueDate: null,
    },
    applicationsOpen: {
      title: 'Applications Open',
      desc: 'Applications are currently open. Waiting for the review phase to begin.',
      dueDate: null,
    },
    readingApplications: {
      title: 'Reading Applications',
      desc: 'Review your assigned applications.',
      dueDate: readingDueDate,
    },
    writtenDelibs: {
      title: 'Written Deliberations',
      desc: 'Discuss applications with the team. Names are hidden.',
      dueDate: null,
    },
    collectingAvailability: {
      title: 'Interview Availability',
      desc: 'Set your availability for upcoming interviews.',
      dueDate: availabilityDueDate,
    },
    interviews: {
      title: 'Interviews',
      desc: 'Conduct interviews and submit your notes.',
      dueDate: null,
    },
    finalDelibs: {
      title: 'Final Deliberations',
      desc: 'Follow along as the Domain Lead finalizes decisions.',
      dueDate: null,
    },
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mentor Dashboard</h1>
        <p className="mt-1 text-gray-500">
          Manage your hiring responsibilities.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-5">
          <div className="bg-blue-100 p-3 rounded-xl">
            <Clock className="w-6 h-6 text-blue-700" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-1">
              Current Cycle Stage
            </h2>
            <p className="text-xl font-bold text-blue-900">
              {stageInfo[currentStage].title}
            </p>
            <p className="text-sm text-blue-700 mt-0.5">
              {stageInfo[currentStage].desc}
            </p>
          </div>
        </div>
        {stageInfo[currentStage].dueDate && (
          <div className="text-right bg-white px-4 py-2 rounded-lg border border-blue-100 shadow-sm">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
              Due Date
            </p>
            <p className="text-sm font-bold text-red-600">
              {new Date(
                stageInfo[currentStage].dueDate as string,
              ).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>
        )}
      </div>

      {/* Stage Content */}
      <div className="transition-all duration-300">
        {currentStage === 'challengeSetup' && (
          <section className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Challenge Setup in Progress
              </h2>
              <p className="text-gray-500">
                Your Domain Lead is currently setting up the challenge questions
                for this cycle. You will be notified when applications are ready
                for review.
              </p>
            </div>
          </section>
        )}

        {currentStage === 'readingApplications' && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-blue-600" />
                Applications ({allCycleApps.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Pending Column */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex flex-col gap-3 min-h-[400px]">
                <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-2">
                  <h3 className="font-bold text-gray-700">Pending</h3>
                  <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm text-gray-600">
                    {pendingApps.length}
                  </span>
                </div>
                {pendingApps.map((app: CycleApp) => (
                  <div
                    key={app.id}
                    className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <h4 className="font-bold text-gray-900 mb-1">
                      {app.user.firstName} {app.user.lastName}
                    </h4>
                    <p className="text-xs text-gray-500 mb-4">
                      {app.domainApplications.length} Domain(s)
                    </p>
                    <Link
                      to={`/mentor/application/${app.id}`}
                      className="flex items-center justify-center px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md text-xs font-medium transition-colors"
                    >
                      <PlayCircle className="w-3.5 h-3.5 mr-1.5" /> Start
                    </Link>
                  </div>
                ))}
                {pendingApps.length === 0 && (
                  <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                    <p className="text-sm text-gray-500 italic">
                      No pending apps
                    </p>
                  </div>
                )}
              </div>

              {/* In Progress Column */}
              <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-4 flex flex-col gap-3 min-h-[400px]">
                <div className="flex items-center justify-between border-b border-blue-200 pb-2 mb-2">
                  <h3 className="font-bold text-blue-800">In Progress</h3>
                  <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border border-blue-200 shadow-sm text-blue-700">
                    {inProgressApps.length}
                  </span>
                </div>
                {inProgressApps.map((app: CycleApp) => (
                  <div
                    key={app.id}
                    className="bg-white p-4 rounded-lg border border-blue-200 shadow-sm hover:shadow-md transition-shadow ring-1 ring-blue-100"
                  >
                    <h4 className="font-bold text-gray-900 mb-1">
                      {app.user.firstName} {app.user.lastName}
                    </h4>
                    <p className="text-xs text-gray-500 mb-4">
                      {app.domainApplications.length} Domain(s)
                    </p>
                    <Link
                      to={`/mentor/application/${app.id}`}
                      className="block w-full text-center px-3 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md text-sm font-medium transition-colors"
                    >
                      Continue Review
                    </Link>
                  </div>
                ))}
                {inProgressApps.length === 0 && (
                  <div className="py-8 text-center border-2 border-dashed border-blue-200 rounded-lg bg-white/50">
                    <p className="text-sm text-blue-400 italic">
                      None in progress
                    </p>
                  </div>
                )}
              </div>

              {/* Finished Column */}
              <div className="bg-green-50/50 rounded-xl border border-green-100 p-4 flex flex-col gap-3 min-h-[400px]">
                <div className="flex items-center justify-between border-b border-green-200 pb-2 mb-2">
                  <h3 className="font-bold text-green-800">Finished</h3>
                  <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border border-green-200 shadow-sm text-green-700">
                    {finishedApps.length}
                  </span>
                </div>
                {finishedApps.map((app: CycleApp) => {
                  const review = app.mentorReviews.find(
                    (r: any) => r.mentorId === mentorUserId,
                  )
                  return (
                    <div
                      key={app.id}
                      className="bg-white p-4 rounded-lg border border-green-200 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-bold text-gray-900">
                          {app.user.firstName} {app.user.lastName}
                        </h4>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      </div>
                      <p className="text-xs font-medium text-gray-600 mb-3 bg-gray-100 inline-block px-2 py-0.5 rounded">
                        {review?.overallRecommendation}
                      </p>
                      <Link
                        to={`/mentor/application/${app.id}`}
                        className="block w-full text-center px-3 py-1.5 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md text-xs font-medium transition-colors"
                      >
                        Edit Review
                      </Link>
                    </div>
                  )
                })}
                {finishedApps.length === 0 && (
                  <div className="py-8 text-center border-2 border-dashed border-green-200 rounded-lg bg-white/50">
                    <p className="text-sm text-green-500 italic">
                      No finished apps
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {currentStage === 'writtenDelibs' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <EyeOff className="w-5 h-5 mr-2 text-blue-600" />
                Written Deliberations — Live View
              </h2>
              <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full flex items-center">
                <EyeOff className="w-4 h-4 mr-1" /> Blinded • Read-only
              </span>
            </div>

            {/* Undecided */}
            {(() => {
              const undecidedApps = allCycleApps.filter(
                (a) =>
                  !writtenDelibsBuckets.advance.includes(a.id) &&
                  !writtenDelibsBuckets.cut.includes(a.id),
              )
              return undecidedApps.length > 0 ? (
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-6">
                  <h3 className="font-semibold text-gray-700 mb-3">
                    Undecided ({undecidedApps.length})
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {undecidedApps.map((app) => (
                      <Link
                        key={app.id}
                        to={`/mentor/application/${app.id}`}
                        className="block group"
                      >
                        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm group-hover:border-blue-400 group-hover:ring-1 group-hover:ring-blue-400 transition-all">
                          <div className="flex justify-between items-start">
                            <h4 className="font-bold text-gray-900 mb-1 group-hover:text-blue-700">
                              Applicant {blindedMap.get(app.id)}
                            </h4>
                            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                          </div>
                          <p className="text-xs text-gray-500 mb-2">
                            {app.domainApplications.length} Domain(s)
                          </p>
                          <p className="text-sm text-gray-700 line-clamp-2 italic">
                            "
                            {app.answers['q-why-dali'] || 'No answer provided.'}
                            "
                          </p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {app.mentorReviews?.map((r: any, i: number) => (
                              <span
                                key={i}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border border-gray-200 bg-gray-50 text-gray-600"
                              >
                                {r.overallRecommendation || 'No Rec'}
                              </span>
                            ))}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null
            })()}

            {/* Advance / Cut columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Advance */}
              <div className="rounded-xl border border-green-200 bg-green-50/50 p-5 min-h-[200px]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-lg text-green-900">
                    Advance to Interview
                  </h3>
                  <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm">
                    {writtenDelibsBuckets.advance.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {writtenDelibsBuckets.advance.map((appId) => {
                    const app = allCycleApps.find((a) => a.id === appId)
                    if (!app) return null
                    return (
                      <Link
                        key={appId}
                        to={`/mentor/application/${appId}`}
                        className="block group"
                      >
                        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm group-hover:border-blue-400 transition-colors flex justify-between items-center">
                          <div>
                            <span className="font-bold text-gray-900 block group-hover:text-blue-700">
                              Applicant {blindedMap.get(appId)}
                            </span>
                            <span className="text-xs text-gray-500 line-clamp-1 mt-1 italic">
                              "{app.answers['q-why-dali'] || ''}"
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                        </div>
                      </Link>
                    )
                  })}
                  {writtenDelibsBuckets.advance.length === 0 && (
                    <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                      <p className="text-sm text-gray-500 italic">Empty</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Cut */}
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 min-h-[200px]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-lg text-red-900">Cut</h3>
                  <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm">
                    {writtenDelibsBuckets.cut.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {writtenDelibsBuckets.cut.map((appId) => {
                    const app = allCycleApps.find((a) => a.id === appId)
                    if (!app) return null
                    return (
                      <Link
                        key={appId}
                        to={`/mentor/application/${appId}`}
                        className="block group"
                      >
                        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm group-hover:border-blue-400 transition-colors flex justify-between items-center">
                          <div>
                            <span className="font-bold text-gray-900 block group-hover:text-blue-700">
                              Applicant {blindedMap.get(appId)}
                            </span>
                            <span className="text-xs text-gray-500 line-clamp-1 mt-1 italic">
                              "{app.answers['q-why-dali'] || ''}"
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                        </div>
                      </Link>
                    )
                  })}
                  {writtenDelibsBuckets.cut.length === 0 && (
                    <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                      <p className="text-sm text-gray-500 italic">Empty</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {currentStage === 'collectingAvailability' && (
          <section className="max-w-5xl mx-auto">
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CalendarDays className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">
                Your Interview Availability
              </h2>
              <p className="text-gray-500 mt-2">
                Click or drag to select the times you are available to conduct
                interviews. 15-minute blocks.
              </p>
            </div>

            {interviewConfig ? (
              <>
                {importError && (
                  <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                    {importError}
                  </div>
                )}
                <CalendarGrid
                  rangeStart={new Date(interviewConfig.interviewStartDate)}
                  rangeEnd={new Date(interviewConfig.interviewEndDate)}
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
              </>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
                <p className="text-gray-500">
                  Interview dates have not been configured yet. Please check back later or contact your Domain Lead.
                </p>
              </div>
            )}
          </section>
        )}

        {currentStage === 'interviews' && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Video className="w-5 h-5 mr-2 text-blue-600" />
              Your Scheduled Interviews ({scheduledInterviews.length})
            </h2>

            {scheduledInterviews.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
                <p className="text-gray-500">
                  No upcoming interviews scheduled.
                </p>
              </div>
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
                            to={`/mentor/application/${interview.applicationId}`}
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
                      <div className="p-6 flex-1 flex flex-col">
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                          Interview Notes
                        </label>
                        <textarea
                          rows={5}
                          value={interviewNotes[interview.id] || ''}
                          onChange={(e) =>
                            setInterviewNotes({
                              ...interviewNotes,
                              [interview.id]: e.target.value,
                            })
                          }
                          placeholder="Jot down notes during or after the interview..."
                          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-3 flex-1 resize-none"
                        />
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => handleSaveNotes(interview.id)}
                            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            <Save className="w-4 h-4 mr-2" />
                            Save Notes
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {currentStage === 'finalDelibs' && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <ListOrdered className="w-5 h-5 mr-2 text-blue-600" />
                Final Deliberations
              </h2>
              <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full flex items-center">
                <EyeOff className="w-4 h-4 mr-1" /> Read-only live view
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {['reject', 'waitlist', 'accept'].map((bucket) => {
                const appIds =
                  finalDelibsBuckets[bucket as keyof typeof finalDelibsBuckets]
                const isReject = bucket === 'reject'
                const isWaitlist = bucket === 'waitlist'
                return (
                  <div
                    key={bucket}
                    className={`rounded-xl border p-5 ${isReject ? 'bg-red-50/50 border-red-200' : isWaitlist ? 'bg-yellow-50/50 border-yellow-200' : 'bg-green-50/50 border-green-200'}`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3
                        className={`font-bold text-lg capitalize ${isReject ? 'text-red-900' : isWaitlist ? 'text-yellow-900' : 'text-green-900'}`}
                      >
                        {bucket}
                      </h3>
                      <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm">
                        {appIds.length}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {appIds.map((appId, i) => {
                        const app = allCycleApps.find((a: CycleApp) => a.id === appId)
                        return (
                          <Link
                            key={appId}
                            to={`/mentor/application/${appId}`}
                            className="block group"
                          >
                            <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex items-start gap-3 group-hover:border-blue-400 transition-colors">
                              <span className="text-gray-400 font-bold text-sm mt-0.5 w-4">
                                {i + 1}.
                              </span>
                              <div className="flex-1">
                                <div className="flex justify-between items-start">
                                  <span className="font-bold text-gray-900 block group-hover:text-blue-700">
                                    Applicant {blindedMap.get(appId)}
                                  </span>
                                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                                </div>
                                {app && (
                                  <span className="text-xs text-gray-500 line-clamp-1 mt-1">
                                    {app.user.firstName} {app.user.lastName}
                                  </span>
                                )}
                              </div>
                            </div>
                          </Link>
                        )
                      })}
                      {appIds.length === 0 && (
                        <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                          <p className="text-sm text-gray-500 italic">Empty</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}