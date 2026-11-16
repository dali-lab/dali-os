import { useState } from "react";
import { cn } from "~/lib/cn";
import { Select, type SelectOption } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { SetupCard, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { slotBlockerMessage, type SlotBlocker } from "~/hiring/lib/slot-blockers";

export const DURATION_OPTIONS = [15, 20, 25, 30, 45, 60]

export const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30]

export const HOUR_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 6) // 6 AM to 8 PM

export function formatHour(h: number) {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

// ─── Coverage Heatmap ────────────────────────────────────────────────────────

export type CoverageData = {
  configured: boolean
  slots: {
    startTime: string
    endTime: string
    freeInterviewerCount: number
    freeInterviewers?: { id: string; firstName: string | null; lastName: string | null; domains: string[] }[]
    bookedInterviewCount: number
  }[]
  domains?: BookableDomain[]
  slotDurationMinutes: number
  timezone: string
  totalInterviewers?: number
}

export type BookableDomain = {
  domainId: string
  domainName: string
  bookableSlotCount: number
  blocker: SlotBlocker | null
  bookingNoticeHours: number
}

// What applicants in each domain are offered on the portal, with the reason
// a domain gets nothing. The heatmap shows who is free; this shows whether a
// free in-domain and cross-domain pair, a room and the booking notice line up.
export function BookableSlotsCard({ coverage }: { coverage: CoverageData | null }) {
  const { bodyText } = useOsChrome()
  if (!coverage || !coverage.configured) return null
  const domains = coverage.domains ?? []
  if (domains.length === 0) return null
  const shared = domains.every((d) => d.blocker === domains[0].blocker) ? domains[0].blocker : null
  const sharedMessage =
    shared && (shared === 'no-config' || shared === 'no-rooms' || shared === 'no-candidates' || shared === 'no-interviewers' || shared === 'one-interviewer')
      ? slotBlockerMessage(shared, { bookingNoticeHours: domains[0].bookingNoticeHours })
      : null
  return (
    <SetupCard title="Bookable slots" description="What applicants in each domain can book on the portal right now.">
      {sharedMessage ? (
        <p className={cn(bodyText, 'text-os-amber')}>{sharedMessage}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((d) => (
            <div key={d.domainId} className="flex flex-col gap-0.5 rounded-os-item bg-os-well px-4 py-3">
              <span className="text-sm font-semibold text-foreground">{d.domainName}</span>
              {d.blocker ? (
                <span className="text-sm text-os-amber">
                  No slots. {slotBlockerMessage(d.blocker, { bookingNoticeHours: d.bookingNoticeHours })}
                </span>
              ) : (
                <span className="text-sm text-os-grey">
                  {d.bookableSlotCount} slot{d.bookableSlotCount === 1 ? '' : 's'} open
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </SetupCard>
  )
}

// A list filter: "all" plus each value present in the list.
export function FilterSelect({ label, value, onChange, allLabel, values }: {
  label: string
  value: string
  onChange: (v: string) => void
  allLabel: string
  values: string[]
}) {
  const { formTrigger } = useOsChrome()
  return (
    <div className="w-48">
      <Select
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={[{ value: 'all', label: allLabel }, ...values.map((v): SelectOption => ({ value: v, label: v }))]}
        buttonClassName={rowTrigger(formTrigger)}
      />
    </div>
  )
}

export function CoverageHeatmap({ coverage }: { coverage: CoverageData | null }) {
  const [showEmpty, setShowEmpty] = useState(false)
  const { bodyText } = useOsChrome()
  if (coverage && !coverage.configured) return null
  if (!coverage || coverage.slots.length === 0) {
    return (
      <SetupCard title="Availability coverage">
        <p className={cn(bodyText, 'py-3 text-center')}>
          {coverage ? 'No future slots in the interview window.' : 'Loading…'}
        </p>
      </SetupCard>
    )
  }

  const tz = coverage.timezone
  // Group slots by local date (YYYY-MM-DD in cycle timezone).
  const byDay = new Map<string, typeof coverage.slots>()
  const timeKeys = new Set<string>()
  for (const slot of coverage.slots) {
    const d = new Date(slot.startTime)
    const dayKey = d.toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD
    const timeKey = d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    timeKeys.add(timeKey)
    if (!byDay.has(dayKey)) byDay.set(dayKey, [])
    byDay.get(dayKey)!.push(slot)
  }
  const days = Array.from(byDay.keys()).sort()
  const allTimes = Array.from(timeKeys).sort()

  // Lookup: (dayKey, timeKey) -> slot
  const lookup = new Map<string, typeof coverage.slots[number]>()
  for (const slot of coverage.slots) {
    const d = new Date(slot.startTime)
    const dayKey = d.toLocaleDateString('en-CA', { timeZone: tz })
    const timeKey = d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    lookup.set(`${dayKey}|${timeKey}`, slot)
  }

  // Rows where at least one day has free interviewers or a booked interview.
  // These are the "interesting" rows — most slots end up all-zero.
  const activeTimes = allTimes.filter((time) =>
    days.some((day) => {
      const s = lookup.get(`${day}|${time}`)
      return s && (s.freeInterviewerCount > 0 || s.bookedInterviewCount > 0)
    }),
  )
  const hiddenCount = allTimes.length - activeTimes.length
  const times = showEmpty ? allTimes : activeTimes

  // Totals
  const totalFreeHours = coverage.slots.reduce((sum, s) => sum + (s.freeInterviewerCount * coverage.slotDurationMinutes) / 60, 0)
  const totalBooked = coverage.slots.reduce((sum, s) => sum + s.bookedInterviewCount, 0)
  const slotHours = coverage.slotDurationMinutes / 60

  function cellColor(freeCount: number) {
    if (freeCount === 0) return 'bg-muted/40 text-muted-foreground'
    if (freeCount <= 2) return 'bg-os-amber/15 text-os-amber'
    if (freeCount <= 4) return 'bg-os-green/15 text-os-green'
    if (freeCount <= 6) return 'bg-os-green/15 text-os-green'
    return 'bg-os-green/25 text-os-green'
  }

  function formatTime(timeKey: string) {
    const [hh, mm] = timeKey.split(':').map(Number)
    const period = hh >= 12 ? 'p' : 'a'
    const h12 = hh % 12 === 0 ? 12 : hh % 12
    return mm === 0 ? `${h12}${period}` : `${h12}:${String(mm).padStart(2, '0')}${period}`
  }

  function formatDay(dayKey: string) {
    // dayKey is YYYY-MM-DD; parse as UTC noon to avoid TZ drift then format.
    const d = new Date(`${dayKey}T12:00:00Z`)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: tz })
  }

  return (
    <SetupCard
      title="Availability coverage"
      description={`${totalFreeHours.toFixed(0)} interviewer-hours offered · ${totalBooked} booked · ${slotHours < 1 ? `${coverage.slotDurationMinutes} min` : `${slotHours} h`} slots`}
      action={
        hiddenCount > 0 && (
          <button type="button" onClick={() => setShowEmpty((v) => !v)} className={buttonClasses('ghost', 'sm')}>
            {showEmpty ? `Hide ${hiddenCount} empty slot${hiddenCount === 1 ? '' : 's'}` : `Show ${hiddenCount} empty slot${hiddenCount === 1 ? '' : 's'}`}
          </button>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="text-[11px] border-separate border-spacing-[2px] leading-none">
          <thead>
            <tr>
              <th className="text-left px-1.5 py-0.5 text-os-grey font-medium sticky left-0 bg-os-card z-10">Time</th>
              {days.map((day) => (
                <th key={day} className="px-1.5 py-0.5 text-center font-semibold text-foreground/80 whitespace-nowrap">
                  {formatDay(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {times.map((time) => (
              <tr key={time}>
                <td className="px-1.5 py-0.5 text-right text-os-grey font-medium sticky left-0 bg-os-card whitespace-nowrap">
                  {formatTime(time)}
                </td>
                {days.map((day) => {
                  const slot = lookup.get(`${day}|${time}`)
                  if (!slot) {
                    return <td key={`${day}-${time}`} className="px-1.5 py-0.5 bg-transparent" />
                  }
                  const free = slot.freeInterviewerCount
                  const booked = slot.bookedInterviewCount
                  const namesList = (slot.freeInterviewers ?? [])
                    .map((p) => {
                      const n = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || '?'
                      return p.domains.length > 0 ? `${n} (${p.domains.join(', ')})` : n
                    })
                  const tooltip = `${free} interviewer${free === 1 ? '' : 's'} free${booked > 0 ? ` · ${booked} booked` : ''}${
                    namesList.length > 0 ? `\n${namesList.join('\n')}` : ''
                  }`
                  return (
                    <td
                      key={`${day}-${time}`}
                      title={tooltip}
                      className={`px-1.5 py-0.5 text-center font-semibold rounded ${cellColor(free)} relative min-w-[36px]`}
                    >
                      {free}
                      {booked > 0 && (
                        <span className="absolute top-0.5 right-0.5 flex gap-0.5">
                          {Array.from({ length: Math.min(booked, 3) }).map((_, i) => (
                            <span key={i} className="w-1.5 h-1.5 rounded-full bg-os-accent" />
                          ))}
                          {booked > 3 && <span className="text-[9px] text-os-accent font-bold leading-none">+</span>}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-os-grey">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-muted/40 border border-border" />0
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-os-amber/15" />1–2 thin
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-os-green/15" />3–4
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-os-green/15" />5–6
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-os-green/25" />7+
        </span>
        <span className="inline-flex items-center gap-1.5 ml-2">
          <span className="w-1.5 h-1.5 rounded-full bg-os-accent" />booked
        </span>
      </div>
    </SetupCard>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────
