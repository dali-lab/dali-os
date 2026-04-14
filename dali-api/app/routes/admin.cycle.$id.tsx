import { useState, useEffect } from 'react'
import { Form, Link, useParams, redirect } from 'react-router'
import type { Route } from "./+types/admin.cycle.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { Settings, Users, Calendar, AlertTriangle, Trash2, Plus, CheckCircle, ArrowRight, Circle, ChevronRight, X } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InterviewConfig {
  id?: string
  slotDurationMinutes: number
  bufferMinutes: number
  dayStartHour: number
  dayEndHour: number
  interviewStartDate: string
  interviewEndDate: string
  timezone: string
}

interface CycleReviewer {
  id: string
  daliMember: { id: string; user?: { id: string; firstName: string; lastName: string } | null }
  domain: { id: string; name: string }
  isLead: boolean
}

interface InterviewRow {
  id: string
  startTime: string
  endTime: string
  status: string
  application: {
    user: { firstName: string; lastName: string }
    domainApplications: { challengeVersion: { domain: { name: string } } }[]
  }
  assignments: {
    id: string
    role: string
    status: string
    cycleReviewer: {
      daliMember: { user: { firstName: string; lastName: string } | null }
      domain: { name: string }
    }
  }[]
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_SEQUENCE = [
  "Draft",
  "Open",
  "Closed",
  "DecisionsReleased",
] as const;

type CycleStatus = (typeof STATUS_SEQUENCE)[number];

function nextStatus(current: CycleStatus): CycleStatus | null {
  const idx = STATUS_SEQUENCE.indexOf(current);
  return idx < STATUS_SEQUENCE.length - 1 ? STATUS_SEQUENCE[idx + 1] : null;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ params }: Route.LoaderArgs) {
  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      domains: {
        include: {
          domain: {
            include: {
              domainLeadAssignments: {
                include: { member: { include: { user: true } } },
              },
            },
          },
        },
      },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      challengeVersions: { include: { challengeVersion: { include: { domain: true, challenge: true } } } },
      formVersion: true,
      applications: {
        include: {
          user: true,
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domainApplications: {
            include: { challengeVersion: { include: { domain: true } } },
          },
        },
      },
    },
  });

  const formVersionOptions = await prisma.applicationFormVersion.findMany({
    include: { applicationForm: true },
    orderBy: { createdAt: "desc" },
  });

  const allDomains = await prisma.domain.findMany({ orderBy: { name: "asc" } });

  return { cycle, formVersionOptions, allDomains };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } });
  if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "select-form") {
    const formVersionId = formData.get("formVersionId") as string;
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { formVersionId },
    });
    return redirect(`/admin/cycle/${params.id}`);
  }

  if (intent === "remove-domain") {
    const domainId = formData.get("domainId") as string;
    await prisma.domainApplicationCycle.delete({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
    });
    return redirect(`/admin/cycle/${params.id}`);
  }

  if (intent === "add-domain") {
    const domainId = formData.get("domainId") as string;
    await prisma.domainApplicationCycle.create({
      data: { domainId, applicationCycleId: params.id },
    });
    return redirect(`/admin/cycle/${params.id}`);
  }

  if (intent === "advance-status") {
    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        domains: true,
        challengeVersions: { include: { challengeVersion: true } },
      },
    });

    const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
    const next = nextStatus(currentStatus as CycleStatus);
    if (!next) return null;

    if (currentStatus === "Draft") {
      const formReady = !!cycle.formVersionId;
      const allDomainsReady = cycle.domains.every((d) => d.isReady === true);
      if (!formReady || !allDomainsReady) return null;
    }

    await prisma.applicationCycleStatusUpdate.create({
      data: {
        newStatus: next,
        applicationCycleId: params.id,
        userId: user.id,
      },
    });
  }

  return redirect(`/admin/cycle/${params.id}`);
}

const DURATION_OPTIONS = [15, 20, 25, 30, 45, 60]
const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30]
const HOUR_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 6) // 6 AM to 8 PM

function formatHour(h: number) {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminCycleDetails() {
  const { id: cycleId } = useParams()

  // ── Interview Config state ──
  const [config, setConfig] = useState<InterviewConfig>({
    slotDurationMinutes: 30,
    bufferMinutes: 15,
    dayStartHour: 9,
    dayEndHour: 18,
    interviewStartDate: '',
    interviewEndDate: '',
    timezone: 'America/New_York',
  })
  const [configSaved, setConfigSaved] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)

  // ── Reviewers state ──
  const [reviewers, setReviewers] = useState<CycleReviewer[]>([])
  const [newMemberId, setNewMemberId] = useState('')
  const [newDomainId, setNewDomainId] = useState('')
  const [newIsLead, setNewIsLead] = useState(false)
  const [allMembers, setAllMembers] = useState<{ id: string; user?: { firstName: string; lastName: string } | null }[]>([])
  const [allDomains, setAllDomains] = useState<{ id: string; name: string }[]>([])

  // ── Interviews state ──
  const [interviews, setInterviews] = useState<InterviewRow[]>([])

  // ── Cycle status ──
  const [cycleStatus, setCycleStatus] = useState<string>('Draft')
  const [statusUpdating, setStatusUpdating] = useState(false)

  const STATUS_FLOW = ['Draft', 'Open', 'Closed', 'DecisionsReleased'] as const
  const STATUS_LABELS: Record<string, string> = {
    Draft: 'Draft', Open: 'Open', Closed: 'Closed', DecisionsReleased: 'Decisions Released',
  }
  const STATUS_COLORS: Record<string, string> = {
    Draft: 'bg-gray-100 text-gray-700', Open: 'bg-green-100 text-green-700',
    Closed: 'bg-yellow-100 text-yellow-700', DecisionsReleased: 'bg-blue-100 text-blue-700',
  }

  async function advanceStatus() {
    if (!cycleId) return
    const idx = STATUS_FLOW.indexOf(cycleStatus as any)
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return
    const next = STATUS_FLOW[idx + 1]
    setStatusUpdating(true)
    try {
      const res = await fetch(`/api/cycles/${cycleId}/status`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: next }),
      })
      if (res.ok) setCycleStatus(next)
    } finally {
      setStatusUpdating(false)
    }
  }

  // ── Active tab ──
  const [tab, setTab] = useState<'config' | 'reviewers' | 'dashboard'>('config')

  // ── Load data ──
  useEffect(() => {
    if (!cycleId) return

    fetch(`/api/cycles/${cycleId}/status`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCycleStatus(data.currentStatus) })
      .catch(() => {})

    fetch(`/api/cycles/${cycleId}/interview-config`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setConfig({
            ...data,
            interviewStartDate: data.interviewStartDate?.slice(0, 10) ?? '',
            interviewEndDate: data.interviewEndDate?.slice(0, 10) ?? '',
          })
        }
      })
      .catch(() => {})

    fetch(`/api/cycles/${cycleId}/reviewers`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setReviewers)
      .catch(() => {})

    fetch('/api/members', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setAllMembers)
      .catch(() => {})

    fetch('/api/domains', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setAllDomains)
      .catch(() => {})

    fetch(`/api/cycles/${cycleId}/interviews`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setInterviews)
      .catch(() => {})
  }, [cycleId])

  // ── Handlers ──

  async function saveConfig() {
    if (!cycleId) return
    setConfigSaving(true)
    try {
      const res = await fetch(`/api/cycles/${cycleId}/interview-config`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setConfigSaved(true)
        setTimeout(() => setConfigSaved(false), 2000)
      }
    } finally {
      setConfigSaving(false)
    }
  }

  async function addReviewer() {
    if (!cycleId || !newMemberId || !newDomainId) return
    const res = await fetch(`/api/cycles/${cycleId}/reviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daliMemberId: newMemberId, domainId: newDomainId, isLead: newIsLead }),
    })
    if (res.ok) {
      const reviewer = await res.json()
      setReviewers(prev => [...prev, reviewer])
      setNewMemberId('')
      setNewDomainId('')
      setNewIsLead(false)
    }
  }

  async function removeReviewer(reviewerId: string) {
    if (!cycleId) return
    const res = await fetch(`/api/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setReviewers(prev => prev.filter(r => r.id !== reviewerId))
    }
  }

  const needsReassignment = interviews.filter(i => i.status === 'NeedsReassignment')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cycle Management</h1>
        <p className="text-gray-500 mt-1">Configure interviews for cycle <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{cycleId}</span></p>
      </div>

      {/* Cycle Status */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-500">Status:</span>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[cycleStatus]}`}>
            {STATUS_LABELS[cycleStatus] ?? cycleStatus}
          </span>
        </div>
        {STATUS_FLOW.indexOf(cycleStatus as any) < STATUS_FLOW.length - 1 && (
          <button
            onClick={advanceStatus}
            disabled={statusUpdating}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
          >
            {statusUpdating ? 'Updating...' : `Advance to ${STATUS_LABELS[STATUS_FLOW[STATUS_FLOW.indexOf(cycleStatus as any) + 1]]}`}
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {([
          { key: 'config', label: 'Interview Setup', icon: Settings },
          { key: 'reviewers', label: 'Reviewer Roster', icon: Users },
          { key: 'dashboard', label: 'Interview Dashboard', icon: Calendar },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.key === 'dashboard' && needsReassignment.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded-full">
                {needsReassignment.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Interview Setup Tab ── */}
      {tab === 'config' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Slot Duration</label>
              <select
                value={config.slotDurationMinutes}
                onChange={e => setConfig(c => ({ ...c, slotDurationMinutes: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} minutes</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Buffer Between Interviews</label>
              <select
                value={config.bufferMinutes}
                onChange={e => setConfig(c => ({ ...c, bufferMinutes: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {BUFFER_OPTIONS.map(b => <option key={b} value={b}>{b} minutes</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Day Start</label>
              <select
                value={config.dayStartHour}
                onChange={e => setConfig(c => ({ ...c, dayStartHour: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Day End</label>
              <select
                value={config.dayEndHour}
                onChange={e => setConfig(c => ({ ...c, dayEndHour: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Interview Start Date</label>
              <input
                type="date"
                value={config.interviewStartDate}
                onChange={e => setConfig(c => ({ ...c, interviewStartDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Interview End Date</label>
              <input
                type="date"
                value={config.interviewEndDate}
                onChange={e => setConfig(c => ({ ...c, interviewEndDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={saveConfig}
              disabled={configSaving || !config.interviewStartDate || !config.interviewEndDate}
              className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
            >
              {configSaving ? 'Saving...' : configSaved ? 'Saved!' : 'Save Configuration'}
            </button>
            {configSaved && <CheckCircle className="w-4 h-4 text-green-500" />}
          </div>
        </div>
      )}

      {/* ── Reviewer Roster Tab ── */}
      {tab === 'reviewers' && (
        <div className="space-y-4">
          {/* Domain Leads section */}
          <DomainLeadsSection domains={allDomains} members={allMembers} />

          {/* Add reviewer form */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Reviewer
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">DALI Member</label>
                <select
                  value={newMemberId}
                  onChange={e => setNewMemberId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.user ? `${m.user.firstName} ${m.user.lastName}` : m.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Domain</label>
                <select
                  value={newDomainId}
                  onChange={e => setNewDomainId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select domain...</option>
                  {allDomains.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newIsLead} onChange={e => setNewIsLead(e.target.checked)} className="rounded" />
                <span className="text-sm text-gray-700">Domain Lead</span>
              </label>
              <button
                onClick={addReviewer}
                disabled={!newMemberId || !newDomainId}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Roster table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-gray-700">Reviewer</th>
                  <th className="text-left px-4 py-3 font-bold text-gray-700">Domain</th>
                  <th className="text-center px-4 py-3 font-bold text-gray-700">Lead</th>
                  <th className="text-right px-4 py-3 font-bold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reviewers.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {r.daliMember.user ? `${r.daliMember.user.firstName} ${r.daliMember.user.lastName}` : r.daliMember.id}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.domain.name}</td>
                    <td className="px-4 py-3 text-center">
                      {r.isLead && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">Lead</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => removeReviewer(r.id)} className="text-red-500 hover:text-red-700 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {reviewers.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No reviewers assigned yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Interview Dashboard Tab ── */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          {needsReassignment.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-800 font-medium">
                {needsReassignment.length} interview{needsReassignment.length > 1 ? 's' : ''} need{needsReassignment.length === 1 ? 's' : ''} reviewer reassignment.
              </p>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-gray-700">Applicant</th>
                  <th className="text-left px-4 py-3 font-bold text-gray-700">Domain</th>
                  <th className="text-left px-4 py-3 font-bold text-gray-700">Time</th>
                  <th className="text-left px-4 py-3 font-bold text-gray-700">Status</th>
                  <th className="text-left px-4 py-3 font-bold text-gray-700">Reviewers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {interviews.map(interview => {
                  const isAlert = interview.status === 'NeedsReassignment'
                  const domains = interview.application.domainApplications
                    .map(da => da.challengeVersion.domain.name)
                    .join(', ')
                  const start = new Date(interview.startTime)
                  const end = new Date(interview.endTime)

                  return (
                    <tr key={interview.id} className={isAlert ? 'bg-red-50' : 'hover:bg-gray-50 transition'}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {interview.application.user.firstName} {interview.application.user.lastName}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{domains || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                        {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                        {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          isAlert ? 'bg-red-100 text-red-700' :
                          interview.status === 'Scheduled' ? 'bg-green-100 text-green-700' :
                          interview.status === 'Completed' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {isAlert && <AlertTriangle className="w-3 h-3 mr-1" />}
                          {interview.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {interview.assignments
                          .filter(a => a.status === 'Active')
                          .map(a => {
                            const name = a.cycleReviewer.daliMember.user
                              ? `${a.cycleReviewer.daliMember.user.firstName} ${a.cycleReviewer.daliMember.user.lastName}`
                              : '?'
                            return `${name} (${a.role === 'InDomain' ? a.cycleReviewer.domain.name : 'Cross'})`
                          })
                          .join(', ') || '—'}
                      </td>
                    </tr>
                  )
                })}
                {interviews.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No interviews scheduled yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FormSelector (from dev) ─────────────────────────────────────────────────

function FormSelector({ cycleId, options, selectedId }: {
  cycleId: string;
  options: any[];
  selectedId: string | null;
}) {
  const [previewId, setPreviewId] = useState<string>(selectedId ?? "");
  const previewVersion = options.find((fv: any) => fv.id === previewId);
  const questions: any[] = previewVersion?.questions ?? [];

  return (
    <div className="space-y-3">
      <Form method="post" className="flex items-end gap-3">
        <input type="hidden" name="intent" value="select-form" />
        <input type="hidden" name="cycleId" value={cycleId} />
        <div className="flex-1">
          <select
            name="formVersionId"
            value={previewId}
            onChange={(e) => setPreviewId(e.target.value)}
            className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" disabled>Select a form…</option>
            {options.map((fv: any) => (
              <option key={fv.id} value={fv.id}>
                {new Date(fv.createdAt).toLocaleDateString()} — {fv.questions.length} question{fv.questions.length !== 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!previewId}
          className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
        {previewVersion && (
          <Link
            to={`/admin/forms/${previewVersion.applicationFormId}`}
            className="px-3 py-2 text-sm font-medium text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50 whitespace-nowrap"
          >
            Manage Form
          </Link>
        )}
      </Form>

      {questions.length > 0 && (
        <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
          {questions.map((q: any, i: number) => (
            <div key={q.key} className="px-4 py-3">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide mr-2">Q{i + 1}</span>
              <span className="text-sm text-gray-700">{q.data.label}</span>
              {q.required && <span className="ml-2 text-xs text-red-500">required</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DomainLeadsSection ──────────────────────────────────────────────────────

function DomainLeadsSection({ domains, members }: {
  domains: { id: string; name: string; domainLeadAssignments?: any[] }[];
  members: { id: string; user?: { firstName: string; lastName: string } | null }[];
}) {
  const [leadsByDomain, setLeadsByDomain] = useState<Record<string, any[]>>(() => {
    const map: Record<string, any[]> = {}
    for (const d of domains) {
      map[d.id] = d.domainLeadAssignments ?? []
    }
    return map
  })
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [selectedMember, setSelectedMember] = useState('')

  // Re-sync when domains prop changes
  useEffect(() => {
    const map: Record<string, any[]> = {}
    for (const d of domains) {
      map[d.id] = d.domainLeadAssignments ?? []
    }
    setLeadsByDomain(map)
  }, [domains])

  async function addLead(domainId: string) {
    if (!selectedMember) return
    const res = await fetch(`/api/domains/${domainId}/leads`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: selectedMember }),
    })
    if (res.ok) {
      const assignment = await res.json()
      setLeadsByDomain(prev => ({ ...prev, [domainId]: [...(prev[domainId] ?? []), assignment] }))
      setSelectedMember('')
      setAddingFor(null)
    }
  }

  async function removeLead(domainId: string, assignmentId: string) {
    const res = await fetch(`/api/domains/${domainId}/leads`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId }),
    })
    if (res.ok) {
      setLeadsByDomain(prev => ({ ...prev, [domainId]: (prev[domainId] ?? []).filter((a: any) => a.id !== assignmentId) }))
    }
  }

  if (domains.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-sm font-bold text-gray-700 mb-4">Domain Leads</h3>
      <div className="space-y-3">
        {domains.map(d => {
          const leads = leadsByDomain[d.id] ?? []
          return (
            <div key={d.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm font-medium text-gray-900 w-32">{d.name}</span>
              <div className="flex-1 flex flex-wrap items-center gap-2">
                {leads.map((a: any) => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">
                    {a.member?.user ? `${a.member.user.firstName} ${a.member.user.lastName}` : a.memberId}
                    <button onClick={() => removeLead(d.id, a.id)} className="text-blue-400 hover:text-red-500 ml-0.5">&times;</button>
                  </span>
                ))}
                {addingFor === d.id ? (
                  <div className="flex items-center gap-1">
                    <select
                      value={selectedMember}
                      onChange={e => setSelectedMember(e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="">Select...</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.user ? `${m.user.firstName} ${m.user.lastName}` : m.id}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => addLead(d.id)} disabled={!selectedMember} className="px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Add</button>
                    <button onClick={() => { setAddingFor(null); setSelectedMember('') }} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingFor(d.id)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add lead</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
