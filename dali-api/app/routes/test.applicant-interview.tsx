import { useState, useEffect } from 'react'
import { Calendar, Clock, CheckCircle, XCircle, RefreshCw, ExternalLink } from 'lucide-react'

/**
 * DEV-ONLY test page for the applicant interview scheduling flow.
 * Uses seeded data (cycle-fall-2026, app-alice for Engineering).
 * Remove this file before shipping to production.
 */

const CYCLE_ID = 'cycle-fall-2026'

// Seeded applications — pick one to test with
const TEST_APPS = [
  { id: 'app-alice', label: 'Alice (Engineering)', domainId: 'domain-eng' },
  { id: 'app-bob', label: 'Bob (Design + Product)', domainId: 'domain-design' },
]

interface Slot {
  startTime: string
  endTime: string
}

interface BookedInterview {
  id: string
  startTime: string
  endTime: string
  status: string
  assignments: { role: string; cycleReviewerId: string }[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatTime(startIso: string, endIso: string) {
  const s = new Date(startIso)
  const e = new Date(endIso)
  return `${s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function buildGcalUrl(start: string, end: string) {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'DALI Lab Interview',
    dates: `${fmt(new Date(start))}/${fmt(new Date(end))}`,
    details: 'Interview with the DALI Lab team.',
    location: 'DALI Lab, 3rd Floor Sudikoff',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

function groupByDate(slots: Slot[]) {
  const map = new Map<string, Slot[]>()
  for (const s of slots) {
    const d = formatDate(s.startTime)
    const group = map.get(d) ?? []
    group.push(s)
    map.set(d, group)
  }
  return Array.from(map.entries()).map(([date, slots]) => ({ date, slots }))
}

export default function TestApplicantInterview() {
  const [selectedApp, setSelectedApp] = useState(TEST_APPS[0])
  const [slots, setSlots] = useState<Slot[]>([])
  const [booked, setBooked] = useState<BookedInterview | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [loading, setLoading] = useState(false)
  const [booking, setBooking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)
  const [declining, setDeclining] = useState(false)

  // Fetch available slots
  function fetchSlots() {
    setLoading(true)
    setError(null)
    fetch(`/api/cycles/${CYCLE_ID}/available-slots?domainId=${selectedApp.domainId}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setSlots(data)
        else setError(data.error ?? 'Failed to load slots')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchSlots()
    setBooked(null)
    setSelectedSlot(null)
    setRescheduling(false)
  }, [selectedApp])

  function handleBook(slot: Slot) {
    setBooking(true)
    setError(null)
    fetch(`/api/cycles/${CYCLE_ID}/book-interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotStart: slot.startTime, slotEnd: slot.endTime, applicationId: selectedApp.id }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.id) {
          setBooked(data)
          setSelectedSlot(null)
          setRescheduling(false)
        } else {
          setError(data.error ?? 'Booking failed')
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setBooking(false))
  }

  function handleCancel() {
    // Since we don't have auth, directly update the interview via admin endpoint
    // For this test page, just clear local state
    setBooked(null)
    setDeclining(false)
    setRescheduling(false)
    fetchSlots()
  }

  function handleReschedule() {
    setRescheduling(true)
    fetchSlots()
  }

  const grouped = groupByDate(slots)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Applicant Interview Test Page</h1>
        <p className="text-gray-500 mt-1">DEV ONLY — tests the scheduling flow end-to-end.</p>
      </div>

      {/* App selector */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
        <label className="text-sm font-bold text-yellow-800 block mb-2">Test as applicant:</label>
        <div className="flex gap-2">
          {TEST_APPS.map(app => (
            <button
              key={app.id}
              onClick={() => setSelectedApp(app)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                selectedApp.id === app.id
                  ? 'bg-yellow-600 text-white'
                  : 'bg-white border border-yellow-300 text-yellow-800 hover:bg-yellow-100'
              }`}
            >
              {app.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {/* Booked interview view */}
      {booked && !rescheduling && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Interview Scheduled</h2>
              <p className="text-sm text-gray-500 mt-1">Your interview has been confirmed.</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">
              <CheckCircle className="w-3 h-3 mr-1" /> {booked.status}
            </span>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Date & Time</span>
              <p className="text-base font-bold text-gray-900">{formatDate(booked.startTime)}</p>
              <p className="text-sm text-gray-700">{formatTime(booked.startTime, booked.endTime)}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Location</span>
              <p className="text-sm text-gray-900">DALI Lab, 3rd Floor Sudikoff</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Assigned Reviewers</span>
              <p className="text-sm text-gray-700">
                {booked.assignments.map(a => `${a.role} (${a.cycleReviewerId.slice(0, 8)}...)`).join(', ')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={buildGcalUrl(booked.startTime, booked.endTime)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition"
            >
              <ExternalLink className="w-4 h-4" /> Add to Google Calendar
            </a>
            <button onClick={handleReschedule} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
              <RefreshCw className="w-4 h-4 inline mr-1" /> Reschedule
            </button>
            {declining ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Cancel?</span>
                <button onClick={handleCancel} className="text-sm font-semibold text-red-600 hover:underline">Yes</button>
                <button onClick={() => setDeclining(false)} className="text-sm font-semibold text-gray-500 hover:underline">No</button>
              </div>
            ) : (
              <button onClick={() => setDeclining(true)} className="text-sm font-medium text-gray-500 hover:text-red-600 transition">Decline</button>
            )}
          </div>
        </div>
      )}

      {/* Slot selection */}
      {(!booked || rescheduling) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {rescheduling ? 'Reschedule Interview' : 'Select Interview Time'}
              </h2>
              <p className="text-sm text-gray-500">
                Showing available slots for <strong>{selectedApp.label}</strong>.
                {rescheduling && (
                  <button onClick={() => setRescheduling(false)} className="text-blue-600 hover:underline ml-2">
                    Cancel reschedule
                  </button>
                )}
              </p>
            </div>
            <button onClick={fetchSlots} disabled={loading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {loading ? (
            <div className="h-32 rounded-xl bg-gray-100 animate-pulse" />
          ) : grouped.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
              <Clock className="w-8 h-8 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-500 mb-2">No available slots.</p>
              <p className="text-xs text-gray-400">Make sure reviewers have set availability in the mentor view first.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map(({ date, slots: daySlots }) => (
                <div key={date}>
                  <h3 className="text-sm font-bold text-gray-900 mb-2">{date}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {daySlots.map(slot => (
                      <button
                        key={slot.startTime}
                        onClick={() => setSelectedSlot(slot)}
                        className={`px-3 py-2.5 rounded-lg text-sm font-medium border-2 text-left transition-all ${
                          selectedSlot?.startTime === slot.startTime
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-900 hover:border-blue-300'
                        }`}
                      >
                        {formatTime(slot.startTime, slot.endTime)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <button
                onClick={() => selectedSlot && handleBook(selectedSlot)}
                disabled={!selectedSlot || booking}
                className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition disabled:opacity-50"
              >
                {booking ? 'Booking...' : 'Confirm Time'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Debug info */}
      <details className="text-xs text-gray-400">
        <summary className="cursor-pointer hover:text-gray-600">Debug info</summary>
        <pre className="mt-2 p-3 rounded bg-gray-50 overflow-auto">
          Cycle: {CYCLE_ID}{'\n'}
          App: {selectedApp.id}{'\n'}
          Domain: {selectedApp.domainId}{'\n'}
          Slots loaded: {slots.length}{'\n'}
          Booked: {booked ? JSON.stringify(booked, null, 2) : 'none'}
        </pre>
      </details>
    </div>
  )
}
