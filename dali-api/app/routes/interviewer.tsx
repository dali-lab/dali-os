import React, { useState, useEffect, useCallback } from 'react'
import { Link, useLoaderData } from 'react-router'
import { redirect } from 'react-router'
import { Clock, Check, Video, AlertTriangle, ChevronDown } from 'lucide-react'
import CalendarGrid from '~/components/CalendarGrid'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import { getActiveCycle } from '~/lib/cycles'
import type { Route } from './+types/interviewer'

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'bg-blue-100 text-blue-700',
  Completed: 'bg-green-100 text-green-700',
  CancelledByApplicant: 'bg-red-100 text-red-700',
  CancelledByAdmin: 'bg-gray-100 text-gray-700',
}

const STATUS_LABELS: Record<string, string> = {
  Scheduled: 'Scheduled',
  Completed: 'Completed',
  CancelledByApplicant: 'Cancelled',
  CancelledByAdmin: 'Cancelled',
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) throw redirect('/login')

  const empty = {
    isInterviewer: false as const,
    activeCycle: null as { id: string; name: string } | null,
    assignments: [] as any[],
    interviewConfig: null as any,
    savedAvailability: [] as { startTime: string; endTime: string }[],
  }

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  })
  if (!member) return empty

  const active = await getActiveCycle()
  if (!active) return empty

  // Find CycleInterviewer records for this member in the active cycle
  const cycleInterviewers = await prisma.cycleInterviewer.findMany({
    where: {
      daliMemberId: member.id,
      applicationCycleId: active.id,
    },
    include: {
      domain: true,
    },
  })

  if (cycleInterviewers.length === 0) return empty

  const cycleInterviewerIds = cycleInterviewers.map((ci) => ci.id)

  // Load interview assignments with full details
  const assignments = await prisma.interviewAssignment.findMany({
    where: {
      cycleInterviewerId: { in: cycleInterviewerIds },
      status: 'Active',
    },
    include: {
      interview: {
        include: {
          domainApplication: {
            include: {
              application: { include: { user: true } },
              challengeVersion: { include: { domain: true } },
            },
          },
        },
      },
      cycleInterviewer: { include: { domain: true } },
      noteVersions: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { interview: { startTime: 'asc' } },
  })

  // Load availability blocks
  const availabilityBlocks = await prisma.interviewerAvailability.findMany({
    where: { cycleInterviewerId: { in: cycleInterviewerIds } },
    select: { startTime: true, endTime: true },
  })

  const savedAvailability = availabilityBlocks.map((b) => ({
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
  }))

  // Load interview config
  const interviewConfig = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: active.id },
  })

  return {
    isInterviewer: true as const,
    activeCycle: { id: active.id, name: active.name },
    assignments,
    interviewConfig: interviewConfig
      ? {
          dayStartHour: interviewConfig.dayStartHour,
          dayEndHour: interviewConfig.dayEndHour,
          interviewStartDate: interviewConfig.interviewStartDate.toISOString(),
          interviewEndDate: interviewConfig.interviewEndDate.toISOString(),
        }
      : null,
    savedAvailability,
  }
}

export default function InterviewerDashboard() {
  const data = useLoaderData<typeof loader>() as any

  const {
    isInterviewer,
    activeCycle,
    assignments,
    interviewConfig: loaderInterviewConfig,
    savedAvailability: loaderAvailability,
  } = data

  // Availability state
  const [savedAvailability, setSavedAvailability] = useState<
    { startTime: string; endTime: string }[]
  >(loaderAvailability ?? [])
  const [availabilitySaving, setAvailabilitySaving] = useState(false)
  const [interviewConfig, setInterviewConfig] = useState<{
    dayStartHour: number
    dayEndHour: number
    interviewStartDate: string
    interviewEndDate: string
  } | null>(loaderInterviewConfig)

  // Sync loader data on navigation
  useEffect(() => {
    setSavedAvailability(loaderAvailability ?? [])
    setInterviewConfig(loaderInterviewConfig)
  }, [loaderAvailability, loaderInterviewConfig])

  const handleSaveAvailability = useCallback(
    async (blocks: { startTime: string; endTime: string }[]) => {
      if (!activeCycle) return
      setAvailabilitySaving(true)
      try {
        const res = await fetch(
          `/api/cycles/${activeCycle.id}/my-availability`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks }),
          },
        )
        if (res.ok) {
          const updated = await res.json()
          setSavedAvailability(updated)
        }
      } finally {
        setAvailabilitySaving(false)
      }
    },
    [activeCycle],
  )

  if (!isInterviewer || !activeCycle) {
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Interviewer Dashboard
        </h1>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-gray-500">
            You are not assigned as an interviewer for any active hiring cycle.
          </p>
        </div>
      </div>
    )
  }

  // Compute interview blocks for calendar overlay
  const interviewBlocks = (assignments ?? [])
    .filter((a: any) => a.interview)
    .map((a: any) => ({
      startTime: a.interview.startTime,
      endTime: a.interview.endTime,
    }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Interviewer Dashboard
        </h1>
        <p className="text-gray-500 mt-1">{activeCycle.name}</p>
      </div>

      {/* Assigned Interviews Table */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Video className="w-5 h-5 mr-2 text-blue-600" />
          Assigned Interviews ({(assignments ?? []).length})
        </h2>

        {(assignments ?? []).length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
            <p className="text-gray-500">No interviews assigned yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Time
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Applicant
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Domain
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(assignments ?? []).map((assignment: any) => {
                  const interview = assignment.interview
                  if (!interview) return null
                  const startDate = new Date(interview.startTime)
                  const endDate = new Date(interview.endTime)
                  const applicant =
                    interview.domainApplication?.application?.user
                  const domain =
                    interview.domainApplication?.challengeVersion?.domain?.name
                  const status = interview.status as string

                  return (
                    <tr key={assignment.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center text-gray-900">
                          <Clock className="w-4 h-4 mr-1.5 text-gray-400" />
                          <span>
                            {startDate.toLocaleDateString(undefined, {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}{' '}
                            {startDate.toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}{' '}
                            -{' '}
                            {endDate.toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {applicant
                          ? `${applicant.firstName} ${applicant.lastName}`
                          : 'Applicant'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {domain ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            assignment.role === 'InDomain'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-teal-100 text-teal-700'
                          }`}
                        >
                          {assignment.role === 'InDomain'
                            ? 'In-Domain'
                            : 'Cross-Domain'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            STATUS_COLORS[status] ??
                            'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {STATUS_LABELS[status] ?? status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/interviewer/interview/${interview.id}`}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Availability Calendar */}
      <section>
        <div className="text-center mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Your Interview Availability
          </h2>
          <p className="text-gray-500 mt-1 text-sm">
            Click or drag to select the times you are available to conduct
            interviews. 15-minute blocks.
          </p>
        </div>

        {interviewConfig ? (
          <CalendarGrid
            rangeStart={new Date(interviewConfig.interviewStartDate)}
            rangeEnd={new Date(interviewConfig.interviewEndDate)}
            dayStartHour={interviewConfig.dayStartHour}
            dayEndHour={interviewConfig.dayEndHour}
            savedBlocks={savedAvailability}
            interviewBlocks={interviewBlocks}
            onSave={handleSaveAvailability}
            saving={availabilitySaving}
          />
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
            <p className="text-gray-500">
              Interview dates have not been configured yet. Please check back
              later.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
