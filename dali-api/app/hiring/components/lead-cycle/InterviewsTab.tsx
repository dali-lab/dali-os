import { useState } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/cn";
import { Select, type SelectOption, Tooltip } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { Toggle } from "~/components/ui/Toggle";
import { DateField } from "~/components/ui/DateField";
import { useToast } from "~/components/ui/toast";
import { useDialog } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { NavSection } from "~/hiring/components/cycle-setup/SectionNav";
import { Pill } from "~/components/ui/Pill";
import { SetupCard, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { DURATION_OPTIONS, BUFFER_OPTIONS, HOUR_OPTIONS, formatHour, BookableSlotsCard, FilterSelect, CoverageHeatmap } from "~/hiring/components/lead-cycle/InterviewCoverage";
import { RoomHoldConflictModal } from "~/hiring/components/lead-cycle/LeadCycleModals";
import { reassignInterviewer, type ReassignTarget } from "~/hiring/components/lead-cycle/interview-actions";
import type { LeadCycleDataState } from "~/hiring/components/lead-cycle/use-lead-cycle-data";
import { seatEligible, type InterviewerAvailability } from "~/hiring/lib/interviewer-pool";
import { AVAILABILITY_ORDER, AVAILABILITY_NOTE } from "~/hiring/lib/lead-cycle-types";
import type { InterviewRow, InterviewAssignmentRow, PendingInviteRow } from "~/hiring/lib/lead-cycle-types";
import type { LeadCycleData } from "~/hiring/lib/lead-cycle.server";

type InterviewsState = Pick<
  LeadCycleDataState,
  | "config" | "setConfig" | "configSaved" | "configSaving" | "availableRooms" | "holdConflicts"
  | "interviewers" | "interviews" | "setInterviews" | "pendingInvites" | "coverage"
  | "loadInterviews" | "loadInterviewers" | "loadCoverage" | "saveConfig" | "keepTheirBookings"
>;

function ScheduleSection({ hiringEmails, state }: { hiringEmails: LeadCycleData["hiringEmails"]; state: InterviewsState }) {
  const os = useOsChrome();
  const toast = useToast();
  const dialog = useDialog();
  const { config, interviewers, interviews, setInterviews, pendingInvites, coverage, loadInterviews, loadInterviewers, loadCoverage } = state;
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [interviewDomainFilter, setInterviewDomainFilter] = useState<string>("all");
  const [interviewStatusFilter, setInterviewStatusFilter] = useState<string>("all");
  const [showCancelledInterviews, setShowCancelledInterviews] = useState<boolean>(false);
  // Filter inputs derived from current data so empty options never show.
  const domainFor = (p: PendingInviteRow) => p.domainApplication.domain.name
  const pendingStatus = (p: PendingInviteRow) => (p.withdrawn ? 'Withdrawn' : 'Awaiting schedule')
  const isCancelled = (status: string) =>
    status === 'CancelledByApplicant' || status === 'CancelledByAdmin'
  // Hide cancelled interviews unless the user opted in. A cancelled-only
  // applicant still surfaces via the pending list ("Awaiting Schedule"),
  // so the dashboard keeps 1 row per applicant.
  const visibleInterviews = showCancelledInterviews
    ? interviews
    : interviews.filter(i => !isCancelled(i.status))
  const hiddenCancelledCount = interviews.length - visibleInterviews.length
  const availableDomains = Array.from(new Set<string>([
    ...visibleInterviews.map(i => i.domainApplication.domain.name).filter(Boolean),
    ...pendingInvites.map(domainFor).filter(Boolean),
  ])).sort()
  const availableStatuses = Array.from(new Set<string>([
    ...new Set(pendingInvites.map(pendingStatus)),
    ...visibleInterviews.map(i => i.status),
  ]))
  const filtersActive = interviewDomainFilter !== 'all' || interviewStatusFilter !== 'all'
  const filteredInterviews = visibleInterviews.filter(i => {
    if (interviewDomainFilter !== 'all' && i.domainApplication.domain.name !== interviewDomainFilter) return false
    if (interviewStatusFilter !== 'all' && i.status !== interviewStatusFilter) return false
    return true
  })
  const filteredPending = pendingInvites.filter(p => {
    if (interviewDomainFilter !== 'all' && domainFor(p) !== interviewDomainFilter) return false
    if (interviewStatusFilter !== 'all' && interviewStatusFilter !== pendingStatus(p)) return false
    return true
  })
  const totalRows = filteredInterviews.length + filteredPending.length
  const totalAll = visibleInterviews.length + pendingInvites.length
  // Show the filter bar whenever there's any data — including cancelled
  // interviews that are currently hidden — so the toggle stays reachable.
  const hasAnyRows = interviews.length + pendingInvites.length > 0
  const tableEmpty = totalRows === 0
  // "Resend invite" needs the InterviewInviteReminder email written.
  // Without it there's nothing to send, so the button is disabled with a
  // tooltip pointing at Setup.
  const reminderTemplateBound = !!hiringEmails?.['notification:InterviewInviteReminder']
  async function resendInvite(daId: string, firstName?: string) {
    if (
      !(await dialog.confirm({
        title: `Resend interview invite to ${firstName ?? 'this applicant'}?`,
        description: 'Re-emails the applicant the scheduling link using the invite reminder email.',
        confirmLabel: 'Resend',
        tone: 'destructive',
      }))
    )
      return
    setResendingInviteId(daId)
    try {
      const res = await fetch(`/api/hiring/domain-applications/${daId}/resend-invite`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Failed to resend invite')
      }
    } finally {
      setResendingInviteId(null)
    }
  }
  async function reopenScheduling(daId: string, firstName?: string) {
    if (
      !(await dialog.confirm({
        title: `Let ${firstName ?? 'this applicant'} rebook?`,
        description: 'Clears their cancellation so they can pick a new time. They are not emailed until you resend the invite.',
        confirmLabel: 'Let them rebook',
      }))
    )
      return
    setReopeningId(daId)
    try {
      const res = await fetch(`/api/hiring/domain-applications/${daId}/reopen-scheduling`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Failed to reopen scheduling')
        return
      }
      await loadInterviews()
    } finally {
      setReopeningId(null)
    }
  }
  const locationLabel = (room: { name: string } | null) => room?.name ?? 'Online'
  async function changeLocation(interview: InterviewRow, newRoomId: string) {
    if (
      !(await dialog.confirm({
        title: 'Change interview location?',
        description: 'Emails the applicant and both interviewers a location-change notice.',
        confirmLabel: 'Change Location',
        tone: 'destructive',
      }))
    )
      return
    const res = await fetch(`/api/hiring/interviews/${interview.id}/location`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: newRoomId || null }),
    })
    if (res.ok) {
      const updated = await res.json()
      setInterviews(prev => prev.map(i =>
        i.id === interview.id ? { ...i, room: updated.room ?? null, zoomJoinUrl: updated.zoomJoinUrl ?? null, videoUrl: updated.videoUrl ?? null } : i
      ))
    } else {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'Failed to update location')
    }
  }
  const reassign = (interview: InterviewRow, a: InterviewAssignmentRow, to: ReassignTarget) =>
    reassignInterviewer({
      interview,
      assignment: a,
      to,
      dialog,
      toast,
      refresh: () => Promise.all([loadInterviews(), loadInterviewers(), loadCoverage()]),
    })
  async function cancelInterview(interview: InterviewRow) {
    const u = interview.domainApplication.application.user
    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'this applicant'
    if (
      !(await dialog.confirm({
        title: `Cancel ${name}'s interview?`,
        description: 'Frees the slot and the room. The applicant keeps their invite and can book a new time. Emails the applicant and both interviewers.',
        confirmLabel: 'Cancel interview',
        cancelLabel: 'Keep it',
        tone: 'destructive',
      }))
    )
      return
    const res = await fetch(`/api/hiring/interviews/${interview.id}/cancel`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifyApplicant: true }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      toast.error(body?.error ?? 'Could not cancel the interview')
      return
    }
    await loadInterviews()
  }
  const applicantLink = (daId: string, u: { firstName?: string | null; lastName?: string | null }) => (
    <Link
      to={`/hiring/applications/${daId}`}
      className="truncate text-sm font-semibold text-foreground hover:underline"
    >
      {u.firstName} {u.lastName}
    </Link>
  )
  const statusTone = (status: string) =>
    status === 'Scheduled' ? 'success' : status === 'Completed' ? 'accent' : 'neutral'
  const smallTrigger = cn(rowTrigger(os.formTrigger), 'h-8 w-auto text-xs')
  const showDomainFilter = availableDomains.length > 1
  const showStatusFilter = availableStatuses.length > 1
  return (
    <div className="flex flex-col gap-6">
      <SetupCard
        title="Schedule"
        description={
          totalAll === 0
            ? 'No interviews scheduled yet.'
            : filtersActive
              ? `Showing ${totalRows} of ${totalAll}.`
              : `${totalAll} applicant${totalAll === 1 ? '' : 's'}.`
        }
      >
        {hasAnyRows && (
          <div className="flex flex-wrap items-center gap-3">
            {showDomainFilter && (
              <FilterSelect label="Domain" value={interviewDomainFilter} onChange={setInterviewDomainFilter} allLabel="All domains" values={availableDomains} />
            )}
            {showStatusFilter && (
              <FilterSelect label="Status" value={interviewStatusFilter} onChange={setInterviewStatusFilter} allLabel="All statuses" values={availableStatuses} />
            )}
            {filtersActive && (
              <button
                type="button"
                onClick={() => { setInterviewDomainFilter('all'); setInterviewStatusFilter('all') }}
                className={buttonClasses('ghost', 'sm')}
              >
                Clear
              </button>
            )}
            <Checkbox
              checked={showCancelledInterviews}
              onChange={(e) => setShowCancelledInterviews(e.target.checked)}
              label={`Show cancelled${hiddenCancelledCount > 0 && !showCancelledInterviews ? ` (${hiddenCancelledCount})` : ''}`}
              className="text-sm text-os-grey select-none"
            />
          </div>
        )}
        {hasAnyRows && (
          <div className="flex flex-col gap-2">
            {filteredPending.map(p => {
              const u = p.domainApplication.application.user
              const invited = new Date(p.invitedAt)
              return (
                <div key={`pending-${p.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {applicantLink(p.domainApplication.id, u)}
                    <span className="text-sm text-os-grey">
                      {[domainFor(p), `Invited ${invited.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill dot={p.withdrawn ? 'danger' : 'warning'}>{pendingStatus(p)}</Pill>
                    {p.withdrawn ? (
                      <button
                        type="button"
                        onClick={() => reopenScheduling(p.domainApplication.id, u.firstName ?? undefined)}
                        disabled={reopeningId === p.domainApplication.id}
                        className={buttonClasses('secondary', 'sm')}
                      >
                        {reopeningId === p.domainApplication.id ? 'Saving…' : 'Let them rebook'}
                      </button>
                    ) : (
                      <Tooltip content={!reminderTemplateBound ? 'Write the invite reminder email on Setup to resend invites.' : null} variant="rich">
                        <span>
                          <button
                            type="button"
                            onClick={() => resendInvite(p.domainApplication.id, u.firstName ?? undefined)}
                            disabled={!reminderTemplateBound || resendingInviteId === p.domainApplication.id}
                            className={buttonClasses('secondary', 'sm')}
                          >
                            {resendingInviteId === p.domainApplication.id ? 'Sending…' : 'Resend invite'}
                          </button>
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )
            })}
            {filteredInterviews.map(interview => {
              const editable = new Date(interview.startTime) > new Date() && interview.status === 'Scheduled'
              const domainName = interview.domainApplication.domain.name
              const start = new Date(interview.startTime)
              const end = new Date(interview.endTime)
              const when = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} to ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              const meetUrl = !interview.room ? (interview.videoUrl ?? interview.zoomJoinUrl) : null
              return (
                <div key={interview.id} className="flex flex-col gap-3 rounded-os-item bg-os-well px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {applicantLink(interview.domainApplication.id, interview.domainApplication.application.user)}
                      <span className="text-sm text-os-grey">{[domainName, when].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className="inline-flex items-center gap-2">
                      <Pill dot={statusTone(interview.status)}>{interview.status}</Pill>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => cancelInterview(interview)}
                          className={buttonClasses('ghost', 'sm')}
                        >
                          Cancel interview
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-os-grey">Location</span>
                      {editable ? (
                        <Select
                          ariaLabel="Location"
                          value={interview.room?.id ?? ""}
                          onChange={(value) => changeLocation(interview, value)}
                          options={[
                            ...(config.rooms ?? []).map((r) => ({ value: r.id, label: r.name })),
                            { value: "", label: "Online" },
                          ]}
                          buttonClassName={smallTrigger}
                        />
                      ) : (
                        <span className="text-foreground">{locationLabel(interview.room)}</span>
                      )}
                      {meetUrl && (
                        <a href={meetUrl} target="_blank" rel="noopener noreferrer" className="text-os-accent hover:underline">
                          Join Google Meet
                        </a>
                      )}
                    </span>
                    {interview.assignments
                      .filter((a) => a.status === 'Active')
                      .map((a) => {
                        const m = a.cycleInterviewer.user
                        const name = m.firstName && m.lastName
                          ? `${m.firstName} ${m.lastName}`
                          : m.daliEmail ?? '?'
                        const roleLabel = a.role === 'InDomain' ? a.cycleInterviewer.domain.name : 'Cross'
                        const candidates = seatEligible(interviewers, {
                          role: a.role,
                          applicantDomainId: interview.domainApplication.domainId,
                          seatedUserIds: interview.assignments
                            .filter((s) => s.status === 'Active')
                            .map((s) => s.cycleInterviewer.userId),
                        })
                          .map((i) => {
                            const im = i.user
                            return {
                              id: i.id as string,
                              name: im?.firstName && im?.lastName ? `${im.firstName} ${im.lastName}` : im?.daliEmail ?? i.id,
                              availability: (interview.availability[i.userId] ?? 'no-calendar') as InterviewerAvailability,
                            }
                          })
                          .sort((x, y) => AVAILABILITY_ORDER.indexOf(x.availability) - AVAILABILITY_ORDER.indexOf(y.availability))
                        const anyFree = candidates.some((c) => c.availability === 'free')
                        const anyAssignable = candidates.some((c) => c.availability !== 'booked')
                        return (
                          <span key={a.id} className="inline-flex items-center gap-2">
                            <span className="text-foreground">{name}</span>
                            <span className="text-os-grey">{roleLabel}</span>
                            {editable && (
                              <Select
                                value=""
                                onChange={(value) => {
                                  const to = candidates.find((c) => c.id === value)
                                  if (to) reassign(interview, a, to)
                                }}
                                placeholder={anyFree ? 'Reassign' : anyAssignable ? 'No one free' : 'No one available'}
                                disabled={!anyAssignable}
                                ariaLabel={`Reassign ${a.role === 'InDomain' ? 'in-domain' : 'cross-domain'} interviewer`}
                                options={candidates.map((c): SelectOption => ({
                                  value: c.id,
                                  label: c.name,
                                  description: AVAILABILITY_NOTE[c.availability],
                                  disabled: c.availability === 'booked',
                                }))}
                                buttonClassName={smallTrigger}
                              />
                            )}
                          </span>
                        )
                      })}
                  </div>
                </div>
              )
            })}
            {tableEmpty && (
              <p className={cn(os.bodyText, 'py-3 text-center')}>
                {totalAll === 0 ? 'No interviews scheduled yet.' : 'No interviews match these filters.'}
              </p>
            )}
          </div>
        )}
      </SetupCard>
      {/* Per-domain availability summary: who has interviewers and how
          many hours each domain has offered. Computed client-side from
          the already-loaded interviewers list. */}
      {interviewers.length > 0 && (() => {
        const byDomain = new Map<string, { count: number; hours: number; submitted: number }>()
        for (const i of interviewers) {
          const name: string = i.domain?.name ?? '—'
          const entry = byDomain.get(name) ?? { count: 0, hours: 0, submitted: 0 }
          entry.count += 1
          entry.hours += (i.availabilityHours ?? 0)
          if ((i.availabilityBlockCount ?? 0) > 0) entry.submitted += 1
          byDomain.set(name, entry)
        }
        const rows = Array.from(byDomain.entries()).sort(([a], [b]) => a.localeCompare(b))
        return (
          <SetupCard title="Coverage by domain" description="Interviewers and free hours per domain.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map(([name, e]) => (
                <div key={name} className="flex flex-col gap-0.5 rounded-os-item bg-os-well px-4 py-3">
                  <span className="text-sm font-semibold text-foreground">{name}</span>
                  <span className="text-sm text-os-grey">
                    {e.count} interviewer{e.count === 1 ? '' : 's'} · {e.hours.toFixed(0)}h free
                  </span>
                  {e.submitted < e.count && (
                    <span className="text-sm text-os-amber">{e.count - e.submitted} with no free time</span>
                  )}
                </div>
              ))}
            </div>
          </SetupCard>
        )
      })()}
      <BookableSlotsCard coverage={coverage} />
      <CoverageHeatmap coverage={coverage} />
    </div>
  );
}

export function InterviewsTab({
  data,
  cycleId,
  tab,
  state,
}: {
  data: LeadCycleData;
  cycleId: string;
  tab: string;
  state: InterviewsState;
}) {
  const os = useOsChrome();
  const { config, setConfig, configSaved, configSaving, availableRooms, holdConflicts, saveConfig, keepTheirBookings } = state;
  return (
    <>
      <NavSection id="interview-config" title="Interview schedule">
      <SetupCard title="Interview schedule" description="When applicants can book and how much notice they need.">
        <div className={cn(os.formClass, 'grid grid-cols-1 gap-4 md:grid-cols-2')}>
          <label className={os.fieldLabel}>
            Slot length
            <Select
              ariaLabel="Slot length"
              value={String(config.slotDurationMinutes)}
              onChange={(value) => setConfig(c => ({ ...c, slotDurationMinutes: Number(value) }))}
              options={DURATION_OPTIONS.map((d): SelectOption => ({ value: String(d), label: `${d} minutes` }))}
              buttonClassName={rowTrigger(os.formTrigger)}
            />
          </label>
          <label className={os.fieldLabel}>
            Buffer between interviews
            <Select
              ariaLabel="Buffer between interviews"
              value={String(config.bufferMinutes)}
              onChange={(value) => setConfig(c => ({ ...c, bufferMinutes: Number(value) }))}
              options={BUFFER_OPTIONS.map((b): SelectOption => ({ value: String(b), label: `${b} minutes` }))}
              buttonClassName={rowTrigger(os.formTrigger)}
            />
          </label>
          <label className={os.fieldLabel}>
            Day start
            <Select
              ariaLabel="Day start"
              value={String(config.dayStartHour)}
              onChange={(value) => setConfig(c => ({ ...c, dayStartHour: Number(value) }))}
              options={HOUR_OPTIONS.map((h): SelectOption => ({ value: String(h), label: formatHour(h) }))}
              buttonClassName={rowTrigger(os.formTrigger)}
            />
          </label>
          <label className={os.fieldLabel}>
            Day end
            <Select
              ariaLabel="Day end"
              value={String(config.dayEndHour)}
              onChange={(value) => setConfig(c => ({ ...c, dayEndHour: Number(value) }))}
              options={HOUR_OPTIONS.map((h): SelectOption => ({ value: String(h), label: formatHour(h) }))}
              buttonClassName={rowTrigger(os.formTrigger)}
            />
          </label>
          <div className={os.fieldLabel}>
            Interview start date
            <DateField
              mode="date"
              value={config.interviewStartDate}
              onChange={(value) => setConfig(c => ({ ...c, interviewStartDate: value }))}
              className="w-full"
              buttonClassName={rowTrigger(os.formTrigger)}
              ariaLabel="Interview start date"
            />
          </div>
          <div className={os.fieldLabel}>
            Interview end date
            <DateField
              mode="date"
              value={config.interviewEndDate}
              onChange={(value) => setConfig(c => ({ ...c, interviewEndDate: value }))}
              className="w-full"
              buttonClassName={rowTrigger(os.formTrigger)}
              ariaLabel="Interview end date"
            />
          </div>
          <label className={os.fieldLabel}>
            Booking notice
            <Select
              ariaLabel="Booking notice"
              value={String(config.bookingNoticeHours)}
              onChange={(value) => setConfig(c => ({ ...c, bookingNoticeHours: Number(value) }))}
              options={[0, 1, 2, 4, 6, 8, 12, 24, 48].map((h): SelectOption => ({ value: String(h), label: h === 0 ? 'No minimum' : `${h} hours ahead` }))}
              buttonClassName={rowTrigger(os.formTrigger)}
            />
          </label>
          <label className={os.fieldLabel}>
            Reschedule notice
            <Select
              ariaLabel="Reschedule notice"
              value={String(config.rescheduleNoticeHours)}
              onChange={(value) => setConfig(c => ({ ...c, rescheduleNoticeHours: Number(value) }))}
              options={[0, 2, 4, 6, 8, 12, 24, 48].map((h): SelectOption => ({ value: String(h), label: h === 0 ? 'No minimum' : `${h} hours before` }))}
              buttonClassName={rowTrigger(os.formTrigger)}
            />
          </label>
          <label className={os.fieldLabel}>
            Cancel notice
            <Select
              ariaLabel="Cancel notice"
              value={String(config.cancelNoticeHours)}
              onChange={(value) => setConfig(c => ({ ...c, cancelNoticeHours: Number(value) }))}
              options={[0, 2, 4, 6, 8, 12, 24, 48].map((h): SelectOption => ({ value: String(h), label: h === 0 ? 'Up until start' : `${h} hours before` }))}
              buttonClassName={rowTrigger(os.formTrigger)}
            />
          </label>
        </div>
        <div className={cn(os.formClass, 'mt-4')}>
          <div className={os.fieldLabel}>
            Interview rooms
            <div className="flex flex-wrap gap-4">
              {availableRooms.map(room => (
                <Checkbox
                  key={room.id}
                  label={room.name}
                  checked={config.roomIds.includes(room.id)}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setConfig(c => ({
                      ...c,
                      roomIds: checked ? [...c.roomIds, room.id] : c.roomIds.filter(id => id !== room.id),
                    }))
                  }}
                />
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">In-person slots are booked into these rooms.</p>
          <Toggle
            tone="os"
            className="mt-4"
            label="Hold these rooms for interviews"
            description="Blocks other bookings during interview hours across the interview window."
            checked={config.holdRooms}
            disabled={config.roomIds.length === 0}
            onChange={(e) => setConfig(c => ({ ...c, holdRooms: e.target.checked }))}
          />
        </div>
        <div>
          <button
            type="button"
            onClick={() => saveConfig()}
            disabled={configSaving || !config.interviewStartDate || !config.interviewEndDate}
            className={buttonClasses('primary', 'md')}
          >
            {configSaving ? 'Saving…' : configSaved ? 'Saved' : 'Save'}
          </button>
        </div>
        {holdConflicts && (
          <RoomHoldConflictModal
            conflicts={holdConflicts}
            timezone={config.timezone}
            saving={configSaving}
            onKeep={keepTheirBookings}
            onOverride={() => saveConfig(true)}
          />
        )}
      </SetupCard>
      </NavSection>
      <NavSection id="schedule" title="Schedule">
        {data.confidentialityRequired ? (
          <ConfidentialityGate
            cycleId={cycleId}
            reason={data.confidentialityRequired}
            next={`/hiring/lead/cycle/${cycleId}?tab=${tab}`}
          />
        ) : (
          <ScheduleSection hiringEmails={data.hiringEmails} state={state} />
        )}
      </NavSection>
    </>
  );
}
