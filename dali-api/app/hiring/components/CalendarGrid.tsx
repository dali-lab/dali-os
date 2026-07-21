import React, { useState, useRef, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { APPLICATION_TZ, zonedWallTimeUtc, getZonedParts } from '~/lib/timezone'
import { Button, buttonClasses } from '~/components/ui/Button'

// ─── Types ─���─────────────────────────────────────────────────────────────────

interface CalendarGridProps {
  /** Monday of the initially displayed week */
  initialWeekStart?: Date
  /** Earliest selectable date */
  rangeStart: Date
  /** Latest selectable date */
  rangeEnd: Date
  dayStartHour: number  // e.g. 9
  dayEndHour: number    // e.g. 18
  /** Already-saved availability blocks (ISO strings) */
  savedBlocks: { startTime: string; endTime: string }[]
  /** Existing interviews to show as non-toggleable overlays */
  interviewBlocks?: { startTime: string; endTime: string }[]
  /** Called when the user saves */
  onSave: (blocks: { startTime: string; endTime: string }[]) => void
  saving?: boolean
  timezone?: string
  /** Called when the user clicks "Import from Google Calendar" */
  onImportFromGoogle?: () => void
  importing?: boolean
  /** When set (and changes), replaces the current selection with these blocks
   *  and marks the grid as dirty so the user can review before saving */
  pendingPrefill?: { startTime: string; endTime: string }[] | null
}

const BLOCK_MINUTES = 15
const BLOCK_HEIGHT_PX = 24

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

// A block key is "YYYY-MM-DD-HH-mm" wall time in the *interview* timezone
// (`tz`), NOT the browser's. All key↔instant conversions route through `tz` so
// a "9:00 AM" cell means 9:00 AM in the configured zone for every interviewer,
// and the UTC instants we save line up with the server's window clip.

/** Build a key from config-timezone wall-clock parts. */
function partsToKey(year: number, month: number, day: number, hour: number, minute: number): string {
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  const h = String(hour).padStart(2, '0')
  const min = String(minute).padStart(2, '0')
  return `${year}-${m}-${d}-${h}-${min}`
}

/** The UTC instant a block key represents, given the interview timezone. */
function keyToUtc(key: string, tz: string): Date {
  const [y, m, d, h, min] = key.split('-').map(Number)
  return zonedWallTimeUtc(y, m, d, h, min, tz)
}

/** Merge adjacent 15-min blocks into contiguous UTC ranges. */
function mergeBlocks(keys: string[], tz: string): { startTime: string; endTime: string }[] {
  if (keys.length === 0) return []
  const sorted = [...keys].sort()
  const ranges: { startTime: string; endTime: string }[] = []
  let rangeStart = keyToUtc(sorted[0], tz)
  let rangeEnd = new Date(rangeStart.getTime() + BLOCK_MINUTES * 60_000)

  for (let i = 1; i < sorted.length; i++) {
    const blockStart = keyToUtc(sorted[i], tz)
    const blockEnd = new Date(blockStart.getTime() + BLOCK_MINUTES * 60_000)
    if (blockStart.getTime() === rangeEnd.getTime()) {
      // Extend current range
      rangeEnd = blockEnd
    } else {
      ranges.push({ startTime: rangeStart.toISOString(), endTime: rangeEnd.toISOString() })
      rangeStart = blockStart
      rangeEnd = blockEnd
    }
  }
  ranges.push({ startTime: rangeStart.toISOString(), endTime: rangeEnd.toISOString() })
  return ranges
}

/** Expand saved UTC ranges into individual config-timezone block keys. */
function expandBlocks(ranges: { startTime: string; endTime: string }[], tz: string): Set<string> {
  const keys = new Set<string>()
  for (const r of ranges) {
    const end = new Date(r.endTime)
    let cursor = new Date(r.startTime)
    while (cursor < end) {
      const p = getZonedParts(cursor, tz)
      keys.add(partsToKey(p.year, p.month, p.day, p.hour, p.minute))
      cursor = new Date(cursor.getTime() + BLOCK_MINUTES * 60_000)
    }
  }
  return keys
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalendarGrid({
  initialWeekStart,
  rangeStart,
  rangeEnd,
  dayStartHour,
  dayEndHour,
  savedBlocks,
  interviewBlocks = [],
  onSave,
  saving = false,
  timezone = APPLICATION_TZ,
  onImportFromGoogle,
  importing = false,
  pendingPrefill,
}: CalendarGridProps) {
  const tz = timezone
  const [weekStart, setWeekStart] = useState(() =>
    getMonday(initialWeekStart ?? rangeStart),
  )
  const [selected, setSelected] = useState<Set<string>>(() =>
    expandBlocks(savedBlocks, tz),
  )
  const [dirty, setDirty] = useState(false)

  // Rebuild selection when savedBlocks change (e.g. after save round-trip)
  useEffect(() => {
    setSelected(expandBlocks(savedBlocks, tz))
    setDirty(false)
  }, [savedBlocks, tz])

  // When the parent provides a prefill (e.g. from Google Calendar import),
  // replace the current selection and mark dirty so the user can review/save.
  useEffect(() => {
    if (pendingPrefill) {
      setSelected(expandBlocks(pendingPrefill, tz))
      setDirty(true)
    }
  }, [pendingPrefill, tz])

  const interviewKeys = expandBlocks(interviewBlocks, tz)

  // Drag state
  const dragging = useRef(false)
  const dragMode = useRef<'add' | 'remove'>('add')
  const dragTouched = useRef<Set<string>>(new Set())
  const gridRef = useRef<HTMLDivElement | null>(null)

  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)) // Mon-Fri
  const rowCount = ((dayEndHour - dayStartHour) * 60) / BLOCK_MINUTES

  // Treat range bounds as whole calendar days: rangeStart/rangeEnd are the
  // first/last allowed day. Cells before rangeStartDay or on/after the day
  // following rangeEnd are out-of-range and not selectable.
  const rangeStartDay = new Date(rangeStart)
  rangeStartDay.setHours(0, 0, 0, 0)
  const dayAfterRangeEnd = addDays(rangeEnd, 1)
  dayAfterRangeEnd.setHours(0, 0, 0, 0)

  const canGoPrev = getMonday(addDays(weekStart, -7)) >= getMonday(rangeStart)
  const canGoNext = addDays(weekStart, 7) <= rangeEnd

  const applyToCell = useCallback(
    (key: string, isPast: boolean) => {
      if (isPast || interviewKeys.has(key) || dragTouched.current.has(key)) return
      dragTouched.current.add(key)
      setSelected((prev) => {
        const next = new Set(prev)
        dragMode.current === 'add' ? next.add(key) : next.delete(key)
        return next
      })
    },
    [interviewKeys],
  )

  const beginDrag = useCallback(
    (key: string, isPast: boolean) => {
      if (isPast || interviewKeys.has(key)) return
      dragging.current = true
      dragMode.current = selected.has(key) ? 'remove' : 'add'
      dragTouched.current = new Set([key])
      setSelected((prev) => {
        const next = new Set(prev)
        dragMode.current === 'add' ? next.add(key) : next.delete(key)
        return next
      })
      setDirty(true)
    },
    [selected, interviewKeys],
  )

  const handleMouseDown = useCallback(
    (key: string, isPast: boolean) => beginDrag(key, isPast),
    [beginDrag],
  )

  const handleMouseEnter = useCallback(
    (key: string, isPast: boolean) => {
      if (!dragging.current) return
      applyToCell(key, isPast)
    },
    [applyToCell],
  )

  const handleMouseUp = useCallback(() => {
    dragging.current = false
    dragTouched.current = new Set()
  }, [])

  // Resolve a touch coordinate to a cell key + past-flag by walking the
  // element under the touch up to the nearest [data-block-key] ancestor.
  const cellAtPoint = useCallback((x: number, y: number) => {
    if (typeof document === 'undefined') return null
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!el) return null
    const cell = el.closest('[data-block-key]') as HTMLElement | null
    if (!cell || !gridRef.current?.contains(cell)) return null
    const key = cell.getAttribute('data-block-key')
    if (!key) return null
    const isPast = cell.getAttribute('data-block-past') === '1'
    return { key, isPast }
  }, [])

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const hit = cellAtPoint(t.clientX, t.clientY)
      if (!hit) return
      beginDrag(hit.key, hit.isPast)
    },
    [beginDrag, cellAtPoint],
  )

  const handleTouchEnd = useCallback(() => {
    dragging.current = false
    dragTouched.current = new Set()
  }, [])

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

  // Non-passive touchmove listener — React attaches touchmove as passive,
  // so we can't preventDefault from a synthetic handler. We only block the
  // default scroll behavior while the user is actively dragging a selection.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current || e.touches.length !== 1) return
      const t = e.touches[0]
      const hit = cellAtPoint(t.clientX, t.clientY)
      if (!hit) return
      e.preventDefault()
      applyToCell(hit.key, hit.isPast)
    }
    grid.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => grid.removeEventListener('touchmove', onTouchMove)
  }, [applyToCell, cellAtPoint])

  const handleSave = () => {
    const merged = mergeBlocks(Array.from(selected), tz)
    onSave(merged)
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      {/* Header: week navigation + import button */}
      <div className="flex flex-wrap items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border gap-2 sm:gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(getMonday(addDays(weekStart, -7)))}
            disabled={!canGoPrev}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <span className="text-sm font-bold text-foreground min-w-[120px] sm:min-w-[140px] text-center">
            {formatDate(weekStart)} — {formatDate(addDays(weekStart, 4))}
          </span>
          <button
            onClick={() => setWeekStart(getMonday(addDays(weekStart, 7)))}
            disabled={!canGoNext}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        {onImportFromGoogle && (
          <button
            onClick={onImportFromGoogle}
            disabled={importing}
            className={buttonClasses('secondary', 'sm')}
          >
            <Calendar className="w-4 h-4" />
            <span className="hidden sm:inline">{importing ? 'Importing…' : 'Import from Google Calendar'}</span>
            <span className="sm:hidden">{importing ? 'Importing…' : 'Import'}</span>
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div
          ref={gridRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          className="grid select-none min-w-[480px] sm:min-w-[600px] grid-cols-[40px_repeat(5,minmax(0,1fr))] sm:grid-cols-[60px_repeat(5,minmax(0,1fr))]"
        >
          {/* Header row */}
          <div className="p-2 text-center border-b border-r border-border text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
            Time
          </div>
          {weekDays.map((d, i) => (
            <div
              key={i}
              className="p-2 text-center border-b border-r last:border-r-0 border-border"
            >
              <div className="text-xs font-bold text-foreground">{formatDay(d)}</div>
              <div className="text-[10px] text-muted-foreground">{formatDate(d)}</div>
            </div>
          ))}

          {/* Time rows */}
          {Array.from({ length: rowCount }, (_, rowIdx) => {
            const totalMinutes = dayStartHour * 60 + rowIdx * BLOCK_MINUTES
            const hour = Math.floor(totalMinutes / 60)
            const minute = totalMinutes % 60
            const isHourBoundary = minute === 0

            return (
              <React.Fragment key={rowIdx}>
                {/* Time label */}
                <div
                  className={`flex items-center justify-center border-r border-border text-[10px] text-muted-foreground/70 ${isHourBoundary ? 'border-t border-border' : ''}`}
                  style={{ height: BLOCK_HEIGHT_PX }}
                >
                  {isHourBoundary ? formatHour(hour) : ''}
                </div>

                {/* Day cells */}
                {weekDays.map((dayDate, colIdx) => {
                  // The day cell's calendar date drives the key (config-tz wall
                  // time); its real instant comes from `keyToUtc` for past-test.
                  const key = partsToKey(
                    dayDate.getFullYear(),
                    dayDate.getMonth() + 1,
                    dayDate.getDate(),
                    hour,
                    minute,
                  )
                  const isSelected = selected.has(key)
                  const isInterview = interviewKeys.has(key)
                  const isPast = keyToUtc(key, tz) < new Date()
                  const cellDate = new Date(dayDate)
                  cellDate.setHours(0, 0, 0, 0)
                  const isOutOfRange = cellDate < rangeStartDay || cellDate >= dayAfterRangeEnd
                  const isLocked = isInterview || isPast || isOutOfRange

                  let bg = 'bg-card hover:bg-green-100 cursor-pointer'

                  if (isInterview) bg = 'bg-blue-100 cursor-not-allowed'
                  else if (isOutOfRange) bg = 'bg-muted/30 cursor-not-allowed'
                  else if (isPast) bg = 'bg-muted/50 cursor-not-allowed'
                  else if (isSelected) bg = 'bg-green-400 hover:bg-green-500 cursor-pointer'

                  return (
                    <div
                      key={key}
                      data-block-key={key}
                      data-block-past={isPast ? '1' : '0'}
                      onMouseDown={() => !isLocked && handleMouseDown(key, isPast)}
                      onMouseEnter={() => !isLocked && handleMouseEnter(key, isPast)}
                      className={`border-r last:border-r-0 border-border transition-colors ${isHourBoundary ? 'border-t border-border' : 'border-t border-border/40'} ${bg}`}
                      style={{ height: BLOCK_HEIGHT_PX }}
                    />
                  )
                })}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-card border border-border rounded" /> Unavailable
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-green-400 rounded" /> Available
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-blue-100 border border-blue-200 rounded" /> Interview booked
          </div>
        </div>
        <div className="flex items-center gap-3 sm:justify-end">
          {dirty && (
            <span className="text-xs text-accent-coral font-medium">Unsaved changes</span>
          )}
          <Button
            onClick={handleSave}
            disabled={!dirty || saving}
            variant="primary"
          >
            {saving ? 'Saving…' : 'Save availability'}
          </Button>
        </div>
      </div>
    </div>
  )
}
