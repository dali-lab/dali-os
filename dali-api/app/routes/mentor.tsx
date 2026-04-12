import { useState } from 'react'
import { Link, useLoaderData } from 'react-router'
import {
  ChevronRight,
  Clock,
  CheckCircle,
  FileText,
  CalendarDays,
  Video,
  EyeOff,
  ListOrdered,
  PlayCircle,
} from 'lucide-react'
import { prisma } from '~/lib/db'
import type { Route } from './+types/mentor'
import type { CycleStage } from '~/types'

export async function loader({}: Route.LoaderArgs) {
  // TODO: replace with session user once login flow is built
  const mentor = await prisma.user.findFirstOrThrow({
    where: { daliEmail: 'admin@dali.dartmouth.edu' },
  })

  // Find the most active cycle
  const cycles = await prisma.applicationCycle.findMany({
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
    orderBy: { createdAt: 'desc' },
  })

  const activeCycle =
    cycles.find((c) => c.statusUpdates[0]?.newStatus === 'Open') ??
    cycles.find((c) => c.statusUpdates[0]?.newStatus === 'Closed') ??
    cycles[0] ??
    null

  const cycleStatus = activeCycle?.statusUpdates[0]?.newStatus ?? null

  const allCycleApps = (activeCycle?.applications ?? []).filter((a) => {
    const latest = a.statusUpdates[0]?.newStatus
    return latest && latest !== 'Draft'
  })

  return { mentor, activeCycle, cycleStatus, allCycleApps }
}

type LoaderData = Awaited<ReturnType<typeof loader>>
type CycleApp = LoaderData['allCycleApps'][number]

export default function MentorDashboard() {
  const { mentor, activeCycle, cycleStatus, allCycleApps } = useLoaderData<typeof loader>()

  const currentStage =
    (cycleStatus === 'Open'
      ? 'readingApplications'
      : cycleStatus === 'Closed'
        ? 'writtenDelibs'
        : 'challengeSetup') as CycleStage

  const blindedMap = new Map<string, string>()
  allCycleApps.forEach((app: CycleApp, index: number) => {
    blindedMap.set(app.id, String.fromCharCode(65 + index))
  })

  const [inProgressIds, setInProgressIds] = useState<string[]>([])

  const finishedIds = new Set(
    allCycleApps
      .filter((a: CycleApp) => a.mentorReviews.some((r) => r.mentorId === mentor.id))
      .map((a: CycleApp) => a.id),
  )

  const finishedApps = allCycleApps.filter((a: CycleApp) => finishedIds.has(a.id))
  const inProgressApps = allCycleApps.filter(
    (a: CycleApp) => inProgressIds.includes(a.id) && !finishedIds.has(a.id),
  )
  const pendingApps = allCycleApps.filter(
    (a: CycleApp) => !inProgressIds.includes(a.id) && !finishedIds.has(a.id),
  )

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const hours = Array.from({ length: 10 }, (_, i) => i + 9)
  const [availableSlots, setAvailableSlots] = useState<Set<string>>(new Set())
  const [availabilitySaved, setAvailabilitySaved] = useState(false)

  const toggleSlot = (day: string, hour: number) => {
    const key = `${day}-${hour}`
    setAvailableSlots((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const stageInfo: Record<CycleStage, { title: string; desc: string; dueDate: string | null }> = {
    challengeSetup: { title: 'Challenge Setup', desc: 'Your Domain Lead is setting up the challenge questions. Hang tight!', dueDate: null },
    challengesReady: { title: 'Challenges Ready', desc: 'Challenges are finalized. Waiting for applications to open.', dueDate: null },
    applicationsOpen: { title: 'Applications Open', desc: 'Applications are currently open. Waiting for the review phase to begin.', dueDate: null },
    readingApplications: { title: 'Reading Applications', desc: 'Review your assigned applications.', dueDate: null },
    writtenDelibs: { title: 'Written Deliberations', desc: 'Discuss applications with the team. Names are hidden.', dueDate: null },
    collectingAvailability: { title: 'Interview Availability', desc: 'Set your availability for upcoming interviews.', dueDate: null },
    interviews: { title: 'Interviews', desc: 'Conduct interviews and submit your notes.', dueDate: null },
    finalDelibs: { title: 'Final Deliberations', desc: 'Follow along as the Domain Lead finalizes decisions.', dueDate: null },
  }

  if (!activeCycle) {
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold text-gray-900">Mentor Dashboard</h1>
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">No active hiring cycle.</div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mentor Dashboard</h1>
        <p className="mt-1 text-gray-500">Manage your hiring responsibilities.</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-5">
          <div className="bg-blue-100 p-3 rounded-xl">
            <Clock className="w-6 h-6 text-blue-700" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-1">Current Cycle Stage</h2>
            <p className="text-xl font-bold text-blue-900">{stageInfo[currentStage].title}</p>
            <p className="text-sm text-blue-700 mt-0.5">{stageInfo[currentStage].desc}</p>
          </div>
        </div>
      </div>

      <div>
        {currentStage === 'challengeSetup' && (
          <section className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Challenge Setup in Progress</h2>
              <p className="text-gray-500">Your Domain Lead is currently setting up the challenge questions for this cycle.</p>
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
              {/* Pending */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex flex-col gap-3 min-h-[400px]">
                <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-2">
                  <h3 className="font-bold text-gray-700">Pending</h3>
                  <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm text-gray-600">{pendingApps.length}</span>
                </div>
                {pendingApps.map((app: CycleApp) => (
                  <div key={app.id} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                    <h4 className="font-bold text-gray-900 mb-1">{app.user.firstName} {app.user.lastName}</h4>
                    <p className="text-xs text-gray-500 mb-4">{app.domainApplications.length} Domain(s)</p>
                    <button
                      onClick={() => setInProgressIds((prev) => [...prev, app.id])}
                      className="w-full flex items-center justify-center px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md text-xs font-medium transition-colors"
                    >
                      <PlayCircle className="w-3.5 h-3.5 mr-1.5" /> Start
                    </button>
                  </div>
                ))}
                {pendingApps.length === 0 && (
                  <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                    <p className="text-sm text-gray-500 italic">No pending apps</p>
                  </div>
                )}
              </div>

              {/* In Progress */}
              <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-4 flex flex-col gap-3 min-h-[400px]">
                <div className="flex items-center justify-between border-b border-blue-200 pb-2 mb-2">
                  <h3 className="font-bold text-blue-800">In Progress</h3>
                  <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border border-blue-200 shadow-sm text-blue-700">{inProgressApps.length}</span>
                </div>
                {inProgressApps.map((app: CycleApp) => (
                  <div key={app.id} className="bg-white p-4 rounded-lg border border-blue-200 shadow-sm ring-1 ring-blue-100">
                    <h4 className="font-bold text-gray-900 mb-1">{app.user.firstName} {app.user.lastName}</h4>
                    <p className="text-xs text-gray-500 mb-4">{app.domainApplications.length} Domain(s)</p>
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
                    <p className="text-sm text-blue-400 italic">None in progress</p>
                  </div>
                )}
              </div>

              {/* Finished */}
              <div className="bg-green-50/50 rounded-xl border border-green-100 p-4 flex flex-col gap-3 min-h-[400px]">
                <div className="flex items-center justify-between border-b border-green-200 pb-2 mb-2">
                  <h3 className="font-bold text-green-800">Finished</h3>
                  <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border border-green-200 shadow-sm text-green-700">{finishedApps.length}</span>
                </div>
                {finishedApps.map((app: CycleApp) => (
                  <div key={app.id} className="bg-white p-4 rounded-lg border border-green-200 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-1">{app.user.firstName} {app.user.lastName}</h4>
                    <p className="text-xs text-gray-500 mb-4">{app.domainApplications.length} Domain(s)</p>
                    <Link
                      to={`/mentor/application/${app.id}`}
                      className="block w-full text-center px-3 py-2 bg-green-600 text-white hover:bg-green-700 rounded-md text-sm font-medium transition-colors"
                    >
                      View Review
                    </Link>
                  </div>
                ))}
                {finishedApps.length === 0 && (
                  <div className="py-8 text-center border-2 border-dashed border-green-200 rounded-lg bg-white/50">
                    <p className="text-sm text-green-400 italic">None finished yet</p>
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
                <EyeOff className="w-4 h-4 mr-1" /> Blinded · Read-only
              </span>
            </div>
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-6">
              <h3 className="font-semibold text-gray-700 mb-3">Undecided ({allCycleApps.length})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allCycleApps.map((app: CycleApp) => (
                  <Link key={app.id} to={`/mentor/application/${app.id}`} className="block group">
                    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm group-hover:border-blue-400 group-hover:ring-1 group-hover:ring-blue-400 transition-all">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-gray-900 mb-1 group-hover:text-blue-700">
                          Applicant {blindedMap.get(app.id)}
                        </h4>
                        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                      </div>
                      <p className="text-xs text-gray-500">{app.domainApplications.length} Domain(s)</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(['Advance to Interview', 'Cut'] as const).map((label) => (
                <div key={label} className={`rounded-xl border p-5 min-h-[200px] ${label === 'Cut' ? 'border-red-200 bg-red-50/50' : 'border-green-200 bg-green-50/50'}`}>
                  <h3 className={`font-bold text-lg mb-4 ${label === 'Cut' ? 'text-red-900' : 'text-green-900'}`}>{label}</h3>
                  <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                    <p className="text-sm text-gray-500 italic">Empty</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentStage === 'collectingAvailability' && (
          <section className="max-w-4xl mx-auto">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
              <div className="text-center mb-8">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CalendarDays className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Your Interview Availability</h2>
                <p className="text-gray-500 mt-2">Click to select the times you are available.</p>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                <div className="grid grid-cols-6 border-b border-gray-200 bg-white">
                  <div className="p-3 text-center border-r border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">Time</div>
                  {days.map((day) => (
                    <div key={day} className="p-3 text-center border-r last:border-r-0 text-sm font-bold text-gray-900">{day}</div>
                  ))}
                </div>
                <div className="divide-y divide-gray-200">
                  {hours.map((hour) => (
                    <div key={hour} className="grid grid-cols-6">
                      <div className="p-3 text-center border-r border-gray-200 bg-white text-xs font-medium text-gray-500">
                        {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
                      </div>
                      {days.map((day) => {
                        const isSelected = availableSlots.has(`${day}-${hour}`)
                        return (
                          <button key={`${day}-${hour}`} onClick={() => toggleSlot(day, hour)}
                            className={`p-4 border-r last:border-r-0 transition-colors ${isSelected ? 'bg-green-400 hover:bg-green-500' : 'bg-white hover:bg-green-50'}`} />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={() => { setAvailabilitySaved(true); setTimeout(() => setAvailabilitySaved(false), 2000) }}
                  disabled={availableSlots.size === 0}
                  className={`px-6 py-2.5 font-medium rounded-lg shadow-sm disabled:opacity-50 ${availabilitySaved ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                  {availabilitySaved ? <span className="inline-flex items-center gap-1.5"><CheckCircle className="w-4 h-4" />Saved!</span> : 'Save Availability'}
                </button>
              </div>
            </div>
          </section>
        )}

        {currentStage === 'interviews' && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Video className="w-5 h-5 mr-2 text-blue-600" />
              Your Scheduled Interviews
            </h2>
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
              <p className="text-gray-500">No upcoming interviews scheduled.</p>
            </div>
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
              {(['Reject', 'Waitlist', 'Accept'] as const).map((bucket) => (
                <div key={bucket} className={`rounded-xl border p-5 ${bucket === 'Reject' ? 'bg-red-50/50 border-red-200' : bucket === 'Waitlist' ? 'bg-yellow-50/50 border-yellow-200' : 'bg-green-50/50 border-green-200'}`}>
                  <h3 className={`font-bold text-lg mb-4 ${bucket === 'Reject' ? 'text-red-900' : bucket === 'Waitlist' ? 'text-yellow-900' : 'text-green-900'}`}>{bucket}</h3>
                  <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                    <p className="text-sm text-gray-500 italic">Empty</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
