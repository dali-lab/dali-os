import { useEffect, useState } from 'react'
import { NotebookPen } from 'lucide-react'
import { CORAL_FOLDER } from '~/components/drive/glyphs'
import { useUserTimeZone } from '~/hooks/useUserTimeZone'
import { upcomingWhen } from '~/components/shell/rail-model'
import type { UpcomingMeeting } from '~/lib/upcoming-meetings.server'
import type { OpenTabRequest } from '~/lib/desktop-tabs'

export const UPCOMING_REFRESH_MS = 5 * 60_000
export const UPCOMING_TICK_MS = 30_000

export function useUpcomingMeetings(enabled: boolean): UpcomingMeeting[] {
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await fetch('/api/upcoming-meetings', { credentials: 'include' })
        if (!res.ok) return
        const json = (await res.json()) as { meetings?: UpcomingMeeting[] }
        if (!cancelled) setMeetings(Array.isArray(json.meetings) ? json.meetings : [])
      } catch {
        // A missed refresh keeps the last list; the next tick retries.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const dropEnded = () => {
      const now = new Date()
      setMeetings((list) => {
        const live = list.filter((m) => new Date(m.endsAt) > now)
        return live.length === list.length ? list : live
      })
    }
    void refresh()
    const timer = window.setInterval(refresh, UPCOMING_REFRESH_MS)
    const ticker = window.setInterval(dropEnded, UPCOMING_TICK_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.clearInterval(ticker)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
  return enabled ? meetings : []
}

export function RailUpcoming({
  meetings,
  tabClickProps,
}: {
  meetings: UpcomingMeeting[]
  tabClickProps: (req: OpenTabRequest) => Record<string, unknown>
}) {
  const timeZone = useUserTimeZone()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const ticker = window.setInterval(() => setNow(new Date()), UPCOMING_TICK_MS)
    return () => window.clearInterval(ticker)
  }, [])
  return (
    <section aria-labelledby="rail-upcoming" className="flex flex-col gap-0.5">
      <h2 id="rail-upcoming" className="flex h-[26px] items-center pl-2.5 text-xs font-semibold text-os-muted">
        Upcoming
      </h2>
      {meetings.map((m) => (
        <button
          key={m.meetingId}
          type="button"
          {...tabClickProps({ url: m.href, label: m.title })}
          className="flex h-8 w-full items-center gap-2.5 rounded-lg pl-2.5 pr-2 text-left text-sm text-os-grey transition-colors hover:bg-os-hover hover:text-foreground"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
            <NotebookPen strokeWidth={1.5} className={`h-[18px] w-[18px] ${CORAL_FOLDER}`} />
          </span>
          <span className="min-w-0 flex-1 truncate">{m.title || 'Untitled'}</span>
          <span className="shrink-0 text-xs text-os-muted">{upcomingWhen(m.startsAt, m.endsAt, now, timeZone)}</span>
        </button>
      ))}
    </section>
  )
}
