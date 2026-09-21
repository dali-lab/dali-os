import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router'
import { CalendarDays } from 'lucide-react'
import { Button, buttonClasses } from '~/components/ui/Button'
import { useOsChrome } from '~/components/os-chrome'
import { cn } from '~/lib/cn'
import { CycleSelector } from '~/hiring/components/CycleSelector'
import { ConfidentialityGate } from '~/hiring/components/ConfidentialityGate'
import { useDialog } from '~/components/ui/dialog'
import { useToast } from '~/components/ui/toast'

// My work → Interviews: the interviewer's assigned interviews. Applicants book
// against each interviewer's DALI OS calendar directly, so there's no
// availability to fill in here.
export function InterviewsView({
  cycles,
  cycleId,
  needsCalendar,
  unsignedAgreement,
}: {
  /** Cycles the viewer interviews on; a picker shows when there's more than one. */
  cycles: { id: string; name: string }[]
  cycleId: string
  /** No linked calendar and no working hours, so applicants can't book them. */
  needsCalendar: boolean
  unsignedAgreement: boolean
}) {
  const dialog = useDialog()
  const toast = useToast()
  const { panel, bodyText } = useOsChrome()
  const [scheduledInterviews, setScheduledInterviews] = useState<any[]>([])

  const loadScheduledInterviews = useCallback(() => {
    fetch(`/api/hiring/cycles/${cycleId}/my-interviews`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((assignments: any[]) => setScheduledInterviews(assignments))
      .catch(() => {})
  }, [cycleId])

  useEffect(() => {
    loadScheduledInterviews()
  }, [loadScheduledInterviews])

  // Mark unavailable for an assigned interview, straight from its card.
  // Mirrors the decline action on the interview detail page, but refreshes the
  // list in place instead of navigating away.
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const handleDeclineInterview = useCallback(
    async (interviewId: string) => {
      if (
        !(await dialog.confirm({
          title: 'Mark yourself unavailable for this interview?',
          confirmLabel: 'Mark unavailable',
          tone: 'destructive',
        }))
      )
        return
      setDecliningId(interviewId)
      try {
        const res = await fetch(
          `/api/hiring/cycles/${cycleId}/my-interviews/${interviewId}/decline`,
          { method: 'POST', credentials: 'include' },
        )
        if (res.ok) {
          loadScheduledInterviews()
          return
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (res.status === 409) {
          toast.error(
            body.error ??
              'No replacement interviewer is available. Please contact the hiring lead.',
          )
          return
        }
        toast.error(`Failed to mark unavailable: ${body.error ?? res.statusText}`)
      } catch (e) {
        toast.error(
          `Failed to mark unavailable: ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      } finally {
        setDecliningId(null)
      }
    },
    [cycleId, loadScheduledInterviews, dialog, toast],
  )

  const formatDay = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const formatTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-8">
      {cycles.length > 1 && <CycleSelector cycles={cycles} activeId={cycleId} />}

      {unsignedAgreement && (
        <ConfidentialityGate cycleId={cycleId} reason="unsigned" next="/hiring?view=interviews" />
      )}

      {needsCalendar && (
        <div className={cn(panel, 'flex flex-wrap items-center justify-between gap-3 p-5')}>
          <p className={bodyText}>
            Interviews are booked based on your DALI OS calendar availability. Please confirm your calendar is up to date.
          </p>
          <Link to="/settings/calendar" className={buttonClasses('primary', 'sm')}>
            <CalendarDays className="w-4 h-4" aria-hidden />
            Calendar settings
          </Link>
        </div>
      )}

      {scheduledInterviews.length === 0 ? (
        <div className="flex min-h-[50vh] items-center justify-center text-center">
          <p className={bodyText}>
            Nothing scheduled yet. Interviews appear here once applicants book your time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {scheduledInterviews.map((assignment: any) => {
            const interview = assignment.interview
            if (!interview) return null
            const startDate = new Date(interview.startTime)
            const endDate = new Date(interview.endTime)
            const applicant = interview.domainApplication?.application?.user
            const domain =
              interview.domainApplication?.domain?.name ??
              interview.domainApplication?.challengeVersion?.domain?.name
            return (
              <div key={assignment.id} className={cn(panel, 'flex flex-col gap-4 p-5')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-heading text-lg font-semibold text-foreground">
                      {applicant ? `${applicant.firstName} ${applicant.lastName}` : 'Applicant'}
                    </h3>
                    {domain && <p className="text-sm text-os-grey">{domain}</p>}
                  </div>
                  <div className="shrink-0 rounded-os-item bg-os-well px-3 py-2 text-right">
                    <p className="text-sm font-semibold text-foreground">{formatDay(startDate)}</p>
                    <p className="text-sm tabular-nums text-os-grey">
                      {formatTime(startDate)} to {formatTime(endDate)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/hiring/interviews/${interview.id}`} className={buttonClasses('primary', 'sm')}>
                    Open interview
                  </Link>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDeclineInterview(interview.id)}
                    disabled={decliningId === interview.id}
                  >
                    {decliningId === interview.id ? 'Marking…' : 'Mark unavailable'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
