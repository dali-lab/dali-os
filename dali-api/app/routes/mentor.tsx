import React, { useState } from 'react'
import { Link } from 'react-router'
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
import { adminUser, applicationCycles, mockApplications } from '~/mockData'
import type { CycleStage } from '~/types'

export function loader() {
  return {}
}

export default function MentorDashboard() {
  const applications = mockApplications
  const saveInterviewNotes = (_appId: string, _notes: string) => {}
  const currentStage = 'readingApplications' as CycleStage
  const readingDueDate: string | null = '2026-04-20T23:59:00Z'
  const availabilityDueDate: string | null = null
  const writtenDelibsBuckets = { advance: [] as string[], cut: [] as string[] }
  const finalDelibsBuckets = {
    reject: [] as string[],
    waitlist: [] as string[],
    accept: [] as string[],
  }
  // For this mock, adminUser (user-2) is the logged-in mentor
  const mentorId = adminUser.id
  const activeCycle =
    applicationCycles.find((c) => c.status === 'UnderReview') ||
    applicationCycles.find((c) => c.status === 'Open') ||
    applicationCycles[0]
  const assignedApps = applications.filter(
    (a) =>
      a.assignedMentorId === mentorId &&
      a.applicationCycleId === activeCycle.id,
  )
  const allCycleApps = applications.filter(
    (a) => a.applicationCycleId === activeCycle.id && a.status !== 'Draft',
  )
  // Build a stable blinded mapping for all cycle apps
  const blindedMap = new Map<string, string>()
  allCycleApps.forEach((app, index) => {
    blindedMap.set(app.id, String.fromCharCode(65 + index))
  })
  const scheduledInterviews = assignedApps.filter(
    (a) =>
      a.status === 'InterviewScheduled' && a.interview?.status === 'Scheduled',
  )
  const [interviewNotes, setInterviewNotes] = useState<Record<string, string>>(
    scheduledInterviews.reduce(
      (acc, app) => ({
        ...acc,
        [app.id]: app.interview?.notes || '',
      }),
      {},
    ),
  )
  const handleSaveNotes = (appId: string) => {
    saveInterviewNotes(appId, interviewNotes[appId] || '')
    alert('Notes saved successfully!')
  }
  // Reading Applications State
  const [inProgressIds, setInProgressIds] = useState<string[]>([])
  const pendingApps = assignedApps.filter(
    (a) =>
      !a.mentorReviews?.some((r) => r.mentorId === mentorId) &&
      !inProgressIds.includes(a.id),
  )
  const inProgressApps = assignedApps.filter(
    (a) =>
      !a.mentorReviews?.some((r) => r.mentorId === mentorId) &&
      inProgressIds.includes(a.id),
  )
  const finishedApps = assignedApps.filter((a) =>
    a.mentorReviews?.some((r) => r.mentorId === mentorId),
  )
  // Interview Availability State
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const hours = Array.from(
    {
      length: 10,
    },
    (_, i) => i + 9,
  ) // 9 AM to 6 PM
  const [availableSlots, setAvailableSlots] = useState<Set<string>>(new Set())
  const [availabilitySaved, setAvailabilitySaved] = useState(false)
  const handleSaveAvailability = () => {
    setAvailabilitySaved(true)
    setTimeout(() => setAvailabilitySaved(false), 2000)
  }
  const toggleSlot = (day: string, hour: number) => {
    const key = `${day}-${hour}`
    setAvailableSlots((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(key)) {
        newSet.delete(key)
      } else {
        newSet.add(key)
      }
      return newSet
    })
  }
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
                Assigned Applications ({assignedApps.length})
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
                {pendingApps.map((app) => (
                  <div
                    key={app.id}
                    className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <h4 className="font-bold text-gray-900 mb-1">
                      Applicant {app.userId.replace('user-', '#')}
                    </h4>
                    <p className="text-xs text-gray-500 mb-4">
                      {app.domainApplications.length} Domain(s)
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          setInProgressIds([...inProgressIds, app.id])
                        }
                        className="flex-1 flex items-center justify-center px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md text-xs font-medium transition-colors"
                      >
                        <PlayCircle className="w-3.5 h-3.5 mr-1.5" /> Start
                      </button>
                    </div>
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
                {inProgressApps.map((app) => (
                  <div
                    key={app.id}
                    className="bg-white p-4 rounded-lg border border-blue-200 shadow-sm hover:shadow-md transition-shadow ring-1 ring-blue-100"
                  >
                    <h4 className="font-bold text-gray-900 mb-1">
                      Applicant {app.userId.replace('user-', '#')}
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
                {finishedApps.map((app) => {
                  const review = app.mentorReviews?.find(
                    (r) => r.mentorId === mentorId,
                  )
                  return (
                    <div
                      key={app.id}
                      className="bg-white p-4 rounded-lg border border-green-200 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-bold text-gray-900">
                          Applicant {app.userId.replace('user-', '#')}
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
                            {app.mentorReviews?.map((r, i) => (
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
          <section className="max-w-4xl mx-auto">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
              <div className="text-center mb-8">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CalendarDays className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">
                  Your Interview Availability
                </h2>
                <p className="text-gray-500 mt-2">
                  Click or drag to select the times you are available to conduct
                  interviews.
                </p>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                <div className="grid grid-cols-6 border-b border-gray-200 bg-white">
                  <div className="p-3 text-center border-r border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </div>
                  {days.map((day) => (
                    <div
                      key={day}
                      className="p-3 text-center border-r border-gray-200 last:border-r-0 text-sm font-bold text-gray-900"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                <div className="divide-y divide-gray-200">
                  {hours.map((hour) => (
                    <div key={hour} className="grid grid-cols-6">
                      <div className="p-3 text-center border-r border-gray-200 bg-white text-xs font-medium text-gray-500">
                        {hour > 12
                          ? `${hour - 12} PM`
                          : hour === 12
                            ? '12 PM'
                            : `${hour} AM`}
                      </div>
                      {days.map((day) => {
                        const isSelected = availableSlots.has(`${day}-${hour}`)
                        return (
                          <button
                            key={`${day}-${hour}`}
                            onClick={() => toggleSlot(day, hour)}
                            className={`p-4 border-r border-gray-200 last:border-r-0 transition-colors ${isSelected ? 'bg-green-400 hover:bg-green-500' : 'bg-white hover:bg-green-50'}`}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex justify-between items-center">
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-white border border-gray-300 rounded"></div>{' '}
                    Unavailable
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-green-400 rounded"></div>{' '}
                    Available
                  </div>
                </div>
                <button
                  onClick={handleSaveAvailability}
                  disabled={availableSlots.size === 0}
                  className={`px-6 py-2.5 font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${availabilitySaved ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                >
                  {availabilitySaved ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4" />
                      Saved!
                    </span>
                  ) : (
                    'Save Availability'
                  )}
                </button>
              </div>
            </div>
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
                {scheduledInterviews.map((app) => {
                  const slot = app.interview?.availableSlots.find(
                    (s) => s.id === app.interview?.scheduledSlotId,
                  )
                  if (!slot) return null
                  const startDate = new Date(slot.startTime)
                  const endDate = new Date(slot.endTime)
                  return (
                    <div
                      key={app.id}
                      className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col"
                    >
                      <div className="p-6 border-b border-gray-200 bg-gray-50 flex justify-between items-start">
                        <div>
                          <h3 className="text-lg font-bold text-gray-900 mb-1">
                            Applicant {app.userId.replace('user-', '#')}
                          </h3>
                          <Link
                            to={`/mentor/application/${app.id}`}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center"
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
                          value={interviewNotes[app.id] || ''}
                          onChange={(e) =>
                            setInterviewNotes({
                              ...interviewNotes,
                              [app.id]: e.target.value,
                            })
                          }
                          placeholder="Jot down notes during or after the interview..."
                          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-3 flex-1 resize-none"
                        />
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => handleSaveNotes(app.id)}
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
                        const app = applications.find((a) => a.id === appId)
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
                                    Applicant{' '}
                                    {app?.userId.replace('user-', '#')}
                                  </span>
                                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                                </div>
                                <span className="text-xs text-gray-500 line-clamp-2 mt-1">
                                  {app?.interview?.notes || 'No notes'}
                                </span>
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
  )
}