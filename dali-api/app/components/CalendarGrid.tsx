import React, { useState, useRef, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'

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

/** Create a block key from a date — "YYYY-MM-DD-HH-mm" */
function blockKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}-${h}-${min}`
}

function blockKeyToDate(key: string): Date {
  const [y, m, d, h, min] = key.split('-').map(Number)
  return new Date(y, m - 1, d, h, min)
}

/** Merge adjacent 15-min blocks into contiguous ranges */
function mergeBlocks(keys: string[]): { startTime: string; endTime: string }[] {
  if (keys.length === 0) return []
  const sorted = [...keys].sort()
  const ranges: { startTime: string; endTime: string }[] = []
  let rangeStart = blockKeyToDate(sorted[0])
  let rangeEnd = new Date(rangeStart.getTime() + BLOCK_MINUTES * 60_000)

  for (let i = 1; i < sorted.length; i++) {
    const blockStart = blockKeyToDate(sorted[i])
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

/** Expand saved availability ranges into individual block keys */
function expandBlocks(ranges: { startTime: string; endTime: string }[]): Set<string> {
  const keys = new Set<string>()
  for (const r of ranges) {
    const start = new Date(r.startTime)
    const end = new Date(r.endTime)
    let cursor = new Date(start)
    while (cursor < end) {
      keys.add(blockKey(cursor))
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
  onImportFromGoogle,
  importing = false,
  pendingPrefill,
}: CalendarGridProps) {
  const [weekStart, setWeekStart] = useState(() =>
    getMonday(initialWeekStart ?? rangeStart),
  )
  const [selected, setSelected] = useState<Set<string>>(() =>
    expandBlocks(savedBlocks),
  )
  const [dirty, setDirty] = useState(false)

  // Rebuild selection when savedBlocks change (e.g. after save round-trip)
  useEffect(() => {
    setSelected(expandBlocks(savedBlocks))
    setDirty(false)
  }, [savedBlocks])

  // When the parent provides a prefill (e.g. from Google Calendar import),
  // replace the current selection and mark dirty so the user can review/save.
  useEffect(() => {
    if (pendingPrefill) {
      setSelected(expandBlocks(pendingPrefill))
      setDirty(true)
    }
  }, [pendingPrefill])

  const interviewKeys = expandBlocks(interviewBlocks)

  // Drag state
  const dragging = useRef(false)
  const dragMode = useRef<'add' | 'remove'>('add')
  const dragTouched = useRef<Set<string>>(new Set())

  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)) // Mon-Fri
  const rowCount = ((dayEndHour - dayStartHour) * 60) / BLOCK_MINUTES

  const canGoPrev = getMonday(addDays(weekStart, -7)) >= getMonday(rangeStart)
  const canGoNext = addDays(weekStart, 7) <= rangeEnd

  const handleMouseDown = useCallback(
    (key: string) => {
      if (interviewKeys.has(key)) return
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

  const handleMouseEnter = useCallback(
    (key: string) => {
      if (!dragging.current || interviewKeys.has(key) || dragTouched.current.has(key)) return
      dragTouched.current.add(key)
      setSelected((prev) => {
        const next = new Set(prev)
        dragMode.current === 'add' ? next.add(key) : next.delete(key)
        return next
      })
    },
    [interviewKeys],
  )

  const handleMouseUp = useCallback(() => {
    dragging.current = false
    dragTouched.current = new Set()
  }, [])

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

  const handleSave = () => {
    const merged = mergeBlocks(Array.from(selected))
    onSave(merged)
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      {/* Header: week navigation + import button */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(getMonday(addDays(weekStart, -7)))}
            disabled={!canGoPrev}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <span className="text-sm font-bold text-foreground min-w-[140px] text-center">
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
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-foreground/80 hover:bg-muted/50 disabled:opacity-50 transition"
          >
            <Calendar className="w-4 h-4" />
            {importing ? 'Importing...' : 'Import from Google Calendar'}
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div className="grid select-none" style={{ gridTemplateColumns: '60px repeat(5, 1fr)', minWidth: 600 }}>
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
                  const cellDate = new Date(dayDate)
                  cellDate.setHours(hour, minute, 0, 0)
                  const key = blockKey(cellDate)
                  const isSelected = selected.has(key)
                  const isInterview = interviewKeys.has(key)
                  const isPast = cellDate < new Date()

                  let bg = 'bg-card hover:bg-green-50'
                  if (isInterview) bg = 'bg-blue-100 cursor-not-allowed'
                  else if (isPast) bg = 'bg-muted/50 cursor-not-allowed'
                  else if (isSelected) bg = 'bg-green-400 hover:bg-green-500'

                  return (
                    <div
                      key={key}
                      onMouseDown={() => !isPast && handleMouseDown(key)}
                      onMouseEnter={() => !isPast && handleMouseEnter(key)}
                      className={`border-r last:border-r-0 border-border transition-colors ${isHourBoundary ? 'border-t border-border' : 'border-t border-gray-50'} ${bg}`}
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
      <div className="flex items-center justify-between px-6 py-4 border-t border-border">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-card border border-gray-300 rounded" /> Unavailable
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-green-400 rounded" /> Available
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-blue-100 border border-blue-200 rounded" /> Interview booked
          </div>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Availability'}
          </button>
        </div>
      </div>
    </div>
  )
}
