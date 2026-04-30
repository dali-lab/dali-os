import React, { useState, useEffect, useCallback } from 'react'
import { Link, useLoaderData } from 'react-router'
import { redirect } from 'react-router'
import { Clock, Check, Video, AlertTriangle, ChevronDown } from 'lucide-react'
import CalendarGrid from '~/components/CalendarGrid'
import { prisma } from '~/lib/db'
import { requireAuth, withAuth } from '~/lib/auth'
import { getActiveCycle } from '~/lib/cycles'
import { getCycleConfidentialityState } from '~/lib/confidentiality'
import { ConfidentialityGate } from '~/components/ConfidentialityGate'
import type { Route } from './+types/interviewer'

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'bg-blue-100 text-blue-700',
  Completed: 'bg-green-100 text-green-700',
  CancelledByApplicant: 'bg-red-100 text-red-700',
  CancelledByAdmin: 'bg-muted text-foreground/80',
}

const STATUS_LABELS: Record<string, string> = {
  Scheduled: 'Scheduled',
  Completed: 'Completed',
  CancelledByApplicant: 'Cancelled',
  CancelledByAdmin: 'Cancelled',
}

export const meta: Route.MetaFunction = () => [{ title: 'Interviewer · DALI OS' }]

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) throw redirect('/login')

  const empty = {
    isInterviewer: false as const,
    activeCycle: null as { id: string; name: string } | null,
    assignments: [] as any[],
    interviewConfig: null as any,
    savedAvailability: [] as { startTime: string; endTime: string }[],
    confidentialityRequired: null as null | "no_agreement" | "unsigned",
  }

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  })
  if (!member) return withAuth(auth, empty)

  const active = await getActiveCycle()
  if (!active) return withAuth(auth, empty)

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

  if (cycleInterviewers.length === 0) return withAuth(auth, empty)

  const cycleInterviewerIds = cycleInterviewers.map((ci) => ci.id)

  const confState = await getCycleConfidentialityState(auth.user.sub, active.id)

  // Load interview assignments with full details — only when the user has
  // signed the cycle's confidentiality agreement. Otherwise we surface a
  // gate placeholder and the rest of the page (availability picker etc.)
  // remains usable.
  const assignments = confState.status === "signed" ? await prisma.interviewAssignment.findMany({
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
  }) : []

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

  return withAuth(auth, {
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
      confidentialityRequired:
        confState.status === "signed" ? null : confState.status,
    })
}

export default function InterviewerDashboard() {
  const data = useLoaderData<typeof loader>() as any

  const {
    isInterviewer,
    activeCycle,
    assignments,
    interviewConfig: loaderInterviewConfig,
    savedAvailability: loaderAvailability,
    confidentialityRequired,
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
        <h1 className="text-2xl font-bold text-foreground">
          Interviewer Dashboard
        </h1>
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <p className="text-muted-foreground">
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
        <h1 className="text-2xl font-bold text-foreground">
          Interviewer Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">{activeCycle.name}</p>
      </div>

      {/* Availability warning */}
      {(savedAvailability ?? []).length === 0 && (
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-yellow-900">You haven't set your availability yet</p>
            <p className="text-sm text-yellow-700 mt-0.5">Applicants can't book interviews with you until you submit your availability blocks below.</p>
          </div>
        </div>
      )}

      {/* Assigned Interviews Table */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center">
          <Video className="w-5 h-5 mr-2 text-blue-600" />
          Assigned Interviews{confidentialityRequired ? '' : ` (${(assignments ?? []).length})`}
        </h2>

        {confidentialityRequired ? (
          <ConfidentialityGate
            cycleId={activeCycle?.id ?? ''}
            reason={confidentialityRequired}
            next="/interviewer"
          />
        ) : (assignments ?? []).length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-8 text-center shadow-sm">
            <p className="text-muted-foreground">No interviews assigned yet.</p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Time
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Applicant
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Domain
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
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
                    <tr key={assignment.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center text-foreground">
                          <Clock className="w-4 h-4 mr-1.5 text-muted-foreground/70" />
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
                      <td className="px-4 py-3 text-foreground">
                        {applicant
                          ? `${applicant.firstName} ${applicant.lastName}`
                          : 'Applicant'}
                      </td>
                      <td className="px-4 py-3 text-foreground/80">
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
                            'bg-muted text-foreground/80'
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
          <h2 className="text-lg font-semibold text-foreground">
            Your Interview Availability
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
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
          <div className="bg-card rounded-xl border border-border p-8 text-center shadow-sm">
            <p className="text-muted-foreground">
              Interview dates have not been configured yet. Please check back
              later.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
