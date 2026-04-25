import { useState, useEffect } from 'react'
import { Form, Link, useParams, useLoaderData, redirect } from 'react-router'
import type { Route } from "./+types/admin.cycle.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { Settings, Users, Calendar, AlertTriangle, Trash2, Plus, CheckCircle, ArrowRight, Circle, ChevronRight, X, LayoutDashboard } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InterviewConfig {
  id?: string
  slotDurationMinutes: number
  bufferMinutes: number
  dayStartHour: number
  dayEndHour: number
  interviewStartDate: string
  interviewEndDate: string
  rescheduleNoticeHours: number
  cancelNoticeHours: number
  timezone: string
}

interface CycleReviewer {
  id: string
  daliMember: { id: string; user?: { id: string; firstName: string; lastName: string } | null }
  domain: { id: string; name: string }
}

interface InterviewRow {
  id: string
  startTime: string
  endTime: string
  status: string
  location: string
  domainApplication: {
    challengeVersion: { domain: { name: string } }
    application: { user: { firstName: string; lastName: string } }
  }
  assignments: {
    id: string
    role: string
    status: string
    cycleInterviewer: {
      daliMember: { firstName: string | null; lastName: string | null; daliEmail: string | null }
      domain: { name: string }
    }
  }[]
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_SEQUENCE = [
  "Draft",
  "Open",
  "UnderReview",
  "Completed",
] as const;

type CycleStatus = (typeof STATUS_SEQUENCE)[number];

function nextStatus(current: CycleStatus): CycleStatus | null {
  const idx = STATUS_SEQUENCE.indexOf(current);
  return idx < STATUS_SEQUENCE.length - 1 ? STATUS_SEQUENCE[idx + 1] : null;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");

  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      domains: {
        include: { domain: true },
      },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      challengeVersions: { include: { challengeVersion: { include: { domain: true, challenge: true } } } },
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

  const allDomains = await prisma.domain.findMany({ orderBy: { name: "asc" } });

  // General challenge versions (domainId is null) for the form picker
  const generalChallengeVersions = await prisma.challengeVersion.findMany({
    where: { domainId: null },
    include: { challenge: true },
    orderBy: { createdAt: "desc" },
  });

  const rubricVersionOptions = await prisma.rubricVersion.findMany({
    where: { rubric: { domainId: null } },
    include: { rubric: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const cycleApplicationReviewCount = await prisma.applicationReview.count({
    where: {
      domainApplication: {
        application: { applicationCycleId: params.id },
      },
    },
  });

  // Final decisions ready for release (HiringLead decisions panel)
  const finalDecisions = await prisma.decision.findMany({
    where: {
      stage: "Final",
      domainApplication: {
        application: { applicationCycleId: params.id },
      },
    },
    include: {
      domainApplication: {
        include: {
          application: { include: { user: { select: { firstName: true, lastName: true } } } },
          challengeVersion: { include: { domain: { select: { name: true } } } },
        },
      },
      madeBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return { cycle, allDomains, finalDecisions, rubricVersionOptions, cycleApplicationReviewCount, generalChallengeVersions };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isHiringLead(auth.user.sub))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } });
  if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set-close-date") {
    const closeDate = formData.get("closeDate") as string;
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { closeDate: closeDate ? new Date(closeDate) : null },
    });
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "set-general-rubric") {
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    const hasAssignedReviews = await prisma.applicationReview.count({
      where: {
        domainApplication: {
          application: { applicationCycleId: params.id },
        },
      },
    });
    if (hasAssignedReviews > 0) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { generalRubricVersionId: rubricVersionId },
    });
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "link-general-form") {
    const challengeVersionId = formData.get("challengeVersionId") as string;
    if (!challengeVersionId) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    // Remove any existing general form link (domainId is null)
    const existing = await prisma.challengeVersionApplicationCycle.findMany({
      where: { applicationCycleId: params.id },
      include: { challengeVersion: true },
    });
    for (const e of existing) {
      if (e.challengeVersion.domainId === null) {
        await prisma.challengeVersionApplicationCycle.delete({
          where: { challengeVersionId_applicationCycleId: { challengeVersionId: e.challengeVersionId, applicationCycleId: params.id } },
        });
      }
    }
    // Link the new one
    await prisma.challengeVersionApplicationCycle.create({
      data: { challengeVersionId, applicationCycleId: params.id },
    });
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "remove-domain" || intent === "add-domain") {
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return new Response(JSON.stringify({ error: "Domains can only be modified in Draft" }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    const domainId = formData.get("domainId") as string;
    if (intent === "remove-domain") {
      await prisma.domainApplicationCycle.delete({
        where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      });
    } else {
      await prisma.domainApplicationCycle.create({
        data: { domainId, applicationCycleId: params.id },
      });
    }
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
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
      const hasCloseDate = !!cycle.closeDate;
      const coveredDomainIds = new Set(
        cycle.challengeVersions.map((cv) => cv.challengeVersion.domainId)
      );
      const allDomainsCovered = cycle.domains.length > 0 && cycle.domains.every((d) => coveredDomainIds.has(d.domainId));
      if (!hasCloseDate || !allDomainsCovered) return null;
    }

    await prisma.applicationCycleStatusUpdate.create({
      data: {
        newStatus: next,
        applicationCycleId: params.id,
        userId: user.id,
      },
    });
  }

  return redirect(`/hiring-lead-admin/cycle/${params.id}`);
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
  const loaderData = useLoaderData<typeof loader>() as any
  const cycle = loaderData?.cycle

  // ── Interview Config state ──
  const [config, setConfig] = useState<InterviewConfig>({
    slotDurationMinutes: 30,
    bufferMinutes: 15,
    dayStartHour: 9,
    dayEndHour: 18,
    interviewStartDate: '',
    interviewEndDate: '',
    rescheduleNoticeHours: 12,
    cancelNoticeHours: 0,
    timezone: 'America/New_York',
  })
  const [configSaved, setConfigSaved] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)

  // ── Reviewers state ──
  const [reviewers, setReviewers] = useState<CycleReviewer[]>([])
  const [newMemberId, setNewMemberId] = useState('')
  const [newDomainId, setNewDomainId] = useState('')
  const [allMembers, setAllMembers] = useState<{ id: string; daliEmail: string; firstName?: string | null; lastName?: string | null }[]>([])
  const [allDomains, setAllDomains] = useState<{ id: string; name: string }[]>([])

  // ── Interviewers state ──
  const [interviewers, setInterviewers] = useState<any[]>([])
  const [newInterviewerMemberId, setNewInterviewerMemberId] = useState('')
  const [newInterviewerDomainId, setNewInterviewerDomainId] = useState('')

  // ── Interviews state ──
  const [interviews, setInterviews] = useState<InterviewRow[]>([])

  // ── Cycle status ──
  const [cycleStatus, setCycleStatus] = useState<string>('Draft')
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)

  const STATUS_FLOW = ['Draft', 'Open', 'UnderReview', 'Completed'] as const
  const STATUS_LABELS: Record<string, string> = {
    Draft: 'Draft', Open: 'Open', UnderReview: 'Under Review', Completed: 'Completed',
  }
  const STATUS_COLORS: Record<string, string> = {
    Draft: 'bg-muted text-muted-foreground', Open: 'bg-green-100 text-green-700',
    UnderReview: 'bg-yellow-100 text-yellow-700', Completed: 'bg-blue-100 text-blue-700',
  }

  async function advanceStatus(force = false) {
    if (!cycleId) return
    const idx = STATUS_FLOW.indexOf(cycleStatus as any)
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return
    const next = STATUS_FLOW[idx + 1]
    setStatusUpdating(true)
    setStatusError(null)
    try {
      const res = await fetch(`/api/cycles/${cycleId}/status`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: next, force }),
      })
      if (res.ok) {
        setCycleStatus(next)
      } else {
        const body = await res.json().catch(() => ({}))
        setStatusError(
          body.error ??
            `Couldn't advance to ${STATUS_LABELS[next] ?? next} (HTTP ${res.status}).`,
        )
      }
    } catch (e: any) {
      setStatusError(e?.message ?? 'Network error advancing status.')
    } finally {
      setStatusUpdating(false)
    }
  }

  // ── Active tab ──
  const [tab, setTab] = useState<'setup' | 'config' | 'reviewers' | 'dashboard' | 'decisions'>('setup')

  // ── Decisions state ──
  const [pendingDecisions, setPendingDecisions] = useState<any[]>(loaderData?.finalDecisions ?? [])
  const [releasing, setReleasing] = useState<string | null>(null)

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

    fetch(`/api/cycles/${cycleId}/interviewers`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setInterviewers)
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
      body: JSON.stringify({ daliMemberId: newMemberId, domainId: newDomainId }),
    })
    if (res.ok) {
      const reviewer = await res.json()
      setReviewers(prev => [...prev, reviewer])
      setNewMemberId('')
      setNewDomainId('')
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

  async function addInterviewer() {
    if (!cycleId || !newInterviewerMemberId || !newInterviewerDomainId) return
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daliMemberId: newInterviewerMemberId, domainId: newInterviewerDomainId }),
    })
    if (res.ok) {
      const interviewer = await res.json()
      const member = allMembers.find(m => m.id === newInterviewerMemberId)
      const domain = allDomains.find(d => d.id === newInterviewerDomainId)
      setInterviewers(prev => [...prev, { ...interviewer, daliMember: member, domain }])
      setNewInterviewerMemberId('')
      setNewInterviewerDomainId('')
    }
  }

  async function removeInterviewer(interviewerId: string) {
    if (!cycleId) return
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewerId }),
    })
    if (res.ok) {
      setInterviewers(prev => prev.filter(i => i.id !== interviewerId))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cycle Management</h1>
        <p className="text-muted-foreground mt-1">Configure interviews for cycle <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{cycleId}</span></p>
      </div>

      {/* Cycle Status */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Status:</span>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[cycleStatus]}`}>
            {STATUS_LABELS[cycleStatus] ?? cycleStatus}
          </span>
        </div>
        {STATUS_FLOW.indexOf(cycleStatus as any) < STATUS_FLOW.length - 1 && (() => {
          const draftChecklistMet = cycleStatus !== 'Draft' || (() => {
            const hasCloseDate = !!cycle?.closeDate;
            const domains = cycle?.domains ?? [];
            const challengeVersions = cycle?.challengeVersions ?? [];
            const coveredDomainIds = new Set(challengeVersions.map((cv: any) => cv.challengeVersion?.domainId));
            const hasGeneralForm = challengeVersions.some((cv: any) => cv.challengeVersion?.domainId === null);
            const hasGeneralRubric = !!cycle?.generalRubricVersionId;
            return hasCloseDate && domains.length > 0 && domains.every((d: any) => coveredDomainIds.has(d.domainId)) && hasGeneralForm && hasGeneralRubric;
          })();
          return (
            <button
              onClick={cycleStatus === 'UnderReview' ? () => setShowCompleteConfirm(true) : () => advanceStatus()}
              disabled={statusUpdating || !draftChecklistMet}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
            >
              {statusUpdating ? 'Updating...' : cycleStatus === 'Draft' ? 'Open Applications' : cycleStatus === 'Open' ? 'Close Applications' : 'Mark as Completed'}
              <ArrowRight className="w-4 h-4" />
            </button>
          );
        })()}
      </div>

      {showCompleteConfirm && (
        <CompleteConfirmModal
          cycleId={cycleId!}
          onClose={() => setShowCompleteConfirm(false)}
          onCompleted={(forced) => { setShowCompleteConfirm(false); setCycleStatus('Completed'); }}
          onError={(msg) => { setShowCompleteConfirm(false); setStatusError(msg); }}
        />
      )}

      {statusError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-900">Couldn't advance cycle status</p>
            <p className="text-sm text-red-800 mt-0.5">{statusError}</p>
          </div>
          <button
            onClick={() => setStatusError(null)}
            className="text-red-600 hover:text-red-800 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Draft Checklist */}
      {cycleStatus === 'Draft' && (() => {
        const hasCloseDate = !!cycle?.closeDate;
        const domains = cycle?.domains ?? [];
        const challengeVersions = cycle?.challengeVersions ?? [];
        const coveredDomainIds = new Set(challengeVersions.map((cv: any) => cv.challengeVersion?.domainId));
        const allDomainsCovered = domains.length > 0 && domains.every((d: any) => coveredDomainIds.has(d.domainId));
        const hasGeneralForm = challengeVersions.some((cv: any) => cv.challengeVersion?.domainId === null);
        const hasGeneralRubric = !!cycle?.generalRubricVersionId;
        const ready = hasCloseDate && allDomainsCovered && hasGeneralForm && hasGeneralRubric;
        return (
          <div className={`rounded-xl border p-4 space-y-3 ${ready ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
            <h3 className="text-sm font-bold text-foreground">Checklist to Open Applications</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                {hasCloseDate
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={hasCloseDate ? 'text-green-800' : 'text-muted-foreground'}>Close date is set</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {allDomainsCovered
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={allDomainsCovered ? 'text-green-800' : 'text-muted-foreground'}>
                  Every domain has a challenge version linked
                  {domains.length === 0 && ' (no domains added)'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {hasGeneralForm
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={hasGeneralForm ? 'text-green-800' : 'text-muted-foreground'}>General application form is linked</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {hasGeneralRubric
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={hasGeneralRubric ? 'text-green-800' : 'text-muted-foreground'}>General application rubric is set</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1">
        {([
          { key: 'setup' as const, label: 'Cycle Setup', icon: LayoutDashboard },
          { key: 'config' as const, label: 'Interview Setup', icon: Settings },
          { key: 'reviewers' as const, label: 'Reviewer Roster', icon: Users },
          { key: 'dashboard' as const, label: 'Interview Dashboard', icon: Calendar },
          { key: 'decisions' as const, label: 'Decisions', icon: CheckCircle },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Cycle Setup Tab ── */}
      {tab === 'setup' && (
        <div className="space-y-6">
          {/* Close Date */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-6">
            <h3 className="text-sm font-bold text-foreground/80 mb-3">Application Close Date</h3>
            <Form method="post" className="flex items-end gap-3">
              <input type="hidden" name="intent" value="set-close-date" />
              <div className="flex-1">
                <input
                  type="date"
                  name="closeDate"
                  defaultValue={cycle?.closeDate ? new Date(cycle.closeDate).toISOString().slice(0, 10) : ''}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
              >
                Save
              </button>
            </Form>
          </div>

          {/* Domains */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-foreground/80">Domains in this Cycle</h3>
            {(cycle?.domains ?? []).length > 0 ? (
              <div className="divide-y divide-border">
                {(cycle?.domains ?? []).map((d: any) => {
                  const hasChallengeVersion = (cycle?.challengeVersions ?? []).some(
                    (cv: any) => cv.challengeVersion?.domainId === d.domainId
                  );
                  return (
                    <div key={d.domainId} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{d.domain?.name ?? d.domainId}</span>
                        {hasChallengeVersion ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">
                            <CheckCircle className="w-3 h-3" /> Challenge linked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-700">
                            <AlertTriangle className="w-3 h-3" /> No challenge
                          </span>
                        )}
                      </div>
                      {cycleStatus === 'Draft' && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="remove-domain" />
                          <input type="hidden" name="domainId" value={d.domainId} />
                          <button type="submit" className="text-red-500 hover:text-red-700 transition">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </Form>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/70">No domains added yet.</p>
            )}
            {cycleStatus === 'Draft' && (
              <Form method="post" className="flex items-end gap-3 pt-2 border-t border-border">
                <input type="hidden" name="intent" value="add-domain" />
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Add Domain</label>
                  <select
                    name="domainId"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    defaultValue=""
                  >
                    <option value="" disabled>Select domain...</option>
                    {(loaderData?.allDomains ?? [])
                      .filter((d: any) => !(cycle?.domains ?? []).some((cd: any) => cd.domainId === d.id))
                      .map((d: any) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </Form>
            )}
          </div>

          {/* General Form picker */}
          <GeneralFormPicker
            currentCvId={(() => {
              const generalCv = (cycle?.challengeVersions ?? []).find((cv: any) => cv.challengeVersion?.domainId === null);
              return generalCv?.challengeVersionId ?? null;
            })()}
            currentCvName={(() => {
              const generalCv = (cycle?.challengeVersions ?? []).find((cv: any) => cv.challengeVersion?.domainId === null);
              return generalCv ? `${generalCv.challengeVersion?.challenge?.name ?? 'Untitled'} (${(generalCv.challengeVersion?.questions as any[])?.length ?? 0} questions)` : null;
            })()}
            options={loaderData?.generalChallengeVersions ?? []}
            locked={cycleStatus !== 'Draft'}
          />

          {/* General Form Rubric */}
          <GeneralRubricPicker
            currentRubricVersionId={cycle?.generalRubricVersionId}
            rubricVersionOptions={loaderData?.rubricVersionOptions ?? []}
            locked={(loaderData?.cycleApplicationReviewCount ?? 0) > 0}
          />
        </div>
      )}

      {/* ── Interview Setup Tab ── */}
      {tab === 'config' && (
        <div className="space-y-6">
          {/* Interview Config */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Slot Duration</label>
              <select
                value={config.slotDurationMinutes}
                onChange={e => setConfig(c => ({ ...c, slotDurationMinutes: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} minutes</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Buffer Between Interviews</label>
              <select
                value={config.bufferMinutes}
                onChange={e => setConfig(c => ({ ...c, bufferMinutes: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {BUFFER_OPTIONS.map(b => <option key={b} value={b}>{b} minutes</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Day Start</label>
              <select
                value={config.dayStartHour}
                onChange={e => setConfig(c => ({ ...c, dayStartHour: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Day End</label>
              <select
                value={config.dayEndHour}
                onChange={e => setConfig(c => ({ ...c, dayEndHour: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Interview Start Date</label>
              <input
                type="date"
                value={config.interviewStartDate}
                onChange={e => setConfig(c => ({ ...c, interviewStartDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Interview End Date</label>
              <input
                type="date"
                value={config.interviewEndDate}
                onChange={e => setConfig(c => ({ ...c, interviewEndDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Reschedule Notice</label>
              <select
                value={config.rescheduleNoticeHours}
                onChange={e => setConfig(c => ({ ...c, rescheduleNoticeHours: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {[0, 2, 4, 6, 8, 12, 24, 48].map(h => <option key={h} value={h}>{h === 0 ? 'No minimum' : `${h} hours before`}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Cancel Notice</label>
              <select
                value={config.cancelNoticeHours}
                onChange={e => setConfig(c => ({ ...c, cancelNoticeHours: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {[0, 2, 4, 6, 8, 12, 24, 48].map(h => <option key={h} value={h}>{h === 0 ? 'Up until start' : `${h} hours before`}</option>)}
              </select>
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
        </div>
      )}

      {/* ── Reviewer Roster Tab ── */}
      {tab === 'reviewers' && (
        <div className="space-y-4">
          {/* Add reviewer form */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-6">
            <h3 className="text-sm font-bold text-foreground/80 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Reviewer
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">DALI Member</label>
                <select
                  value={newMemberId}
                  onChange={e => setNewMemberId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Domain</label>
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
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Reviewer</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reviewers.map(r => (
                  <tr key={r.id} className="hover:bg-muted/50 transition">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {r.daliMember.user ? `${r.daliMember.user.firstName} ${r.daliMember.user.lastName}` : r.daliMember.id}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.domain.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => removeReviewer(r.id)} className="text-red-500 hover:text-red-700 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {reviewers.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground/70">No reviewers assigned yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Add interviewer form */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-6">
            <h3 className="text-sm font-bold text-foreground/80 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Interviewer
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">DALI Member</label>
                <select
                  value={newInterviewerMemberId}
                  onChange={e => setNewInterviewerMemberId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Domain</label>
                <select
                  value={newInterviewerDomainId}
                  onChange={e => setNewInterviewerDomainId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select domain...</option>
                  {allDomains.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={addInterviewer}
                disabled={!newInterviewerMemberId || !newInterviewerDomainId}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Interviewer roster table */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Interviewer</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {interviewers.map((i: any) => {
                  const m = i.daliMember
                  const name = m?.firstName && m?.lastName ? `${m.firstName} ${m.lastName}` : m?.daliEmail ?? i.daliMemberId
                  return (
                    <tr key={i.id} className="hover:bg-muted/50 transition">
                      <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{i.domain?.name ?? ''}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => removeInterviewer(i.id)} className="text-red-500 hover:text-red-700 transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {interviewers.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground/70">No interviewers assigned yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Interview Dashboard Tab ── */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Applicant</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Time</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Status</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Location</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Interviewers</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {interviews.map(interview => {
                  const isFuture = new Date(interview.startTime) > new Date()
                  const domainName = interview.domainApplication.challengeVersion.domain.name
                  const start = new Date(interview.startTime)
                  const end = new Date(interview.endTime)

                  return (
                    <tr key={interview.id} className="hover:bg-muted/50 transition">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {interview.domainApplication.application.user.firstName} {interview.domainApplication.application.user.lastName}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{domainName || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                        {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                        {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          interview.status === 'Scheduled' ? 'bg-green-100 text-green-700' :
                          interview.status === 'Completed' ? 'bg-blue-100 text-blue-700' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {interview.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isFuture && interview.status === 'Scheduled' ? (
                          <select
                            value={interview.location}
                            onChange={async (e) => {
                              const newLocation = e.target.value
                              const res = await fetch(`/api/interviews/${interview.id}/location`, {
                                method: 'PATCH',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ location: newLocation }),
                              })
                              if (res.ok) {
                                setInterviews(prev => prev.map(i =>
                                  i.id === interview.id ? { ...i, location: newLocation } : i
                                ))
                              } else {
                                const body = await res.json().catch(() => ({}))
                                alert(body.error ?? 'Failed to update location')
                              }
                            }}
                            className="text-xs border border-border rounded px-1.5 py-0.5 bg-card"
                          >
                            <option value="PodAppa">Pod Appa</option>
                            <option value="PodMomo">Pod Momo</option>
                            <option value="Online">Online</option>
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {interview.location === 'PodAppa' ? 'Pod Appa' :
                             interview.location === 'PodMomo' ? 'Pod Momo' : 'Online'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {interview.assignments
                          .filter((a: any) => a.status === 'Active')
                          .map((a: any) => {
                            const m = a.cycleInterviewer.daliMember
                            const name = m.firstName && m.lastName
                              ? `${m.firstName} ${m.lastName}`
                              : m.daliEmail ?? '?'
                            const roleLabel = a.role === 'InDomain' ? a.cycleInterviewer.domain.name : 'Cross'
                            return (
                              <div key={a.id} className="flex items-center gap-1">
                                <span>{name} ({roleLabel})</span>
                                {isFuture && interview.status === 'Scheduled' && (
                                  <select
                                    className="ml-1 text-[10px] border border-gray-300 rounded px-1 py-0.5"
                                    defaultValue=""
                                    onChange={async (e) => {
                                      if (!e.target.value) return
                                      await fetch(`/api/interviews/${interview.id}/reassign`, {
                                        method: 'POST', credentials: 'include',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ assignmentId: a.id, newCycleInterviewerId: e.target.value }),
                                      })
                                      window.location.reload()
                                    }}
                                  >
                                    <option value="">Reassign...</option>
                                    {interviewers
                                      .filter((i: any) => a.role === 'InDomain'
                                        ? i.domain?.name === a.cycleInterviewer.domain.name
                                        : i.domain?.name !== domainName)
                                      .filter((i: any) => i.id !== a.cycleInterviewerId)
                                      .map((i: any) => {
                                        const im = i.daliMember
                                        const iName = im?.firstName && im?.lastName ? `${im.firstName} ${im.lastName}` : im?.daliEmail ?? i.id
                                        return <option key={i.id} value={i.id}>{iName}</option>
                                      })}
                                  </select>
                                )}
                              </div>
                            )
                          })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* placeholder for future actions */}
                      </td>
                    </tr>
                  )
                })}
                {interviews.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground/70">No interviews scheduled yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Decisions Tab ── */}
      {tab === 'decisions' && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-muted/50 flex items-center justify-between">
              <h3 className="font-bold text-foreground">Final Decisions Ready for Release</h3>
              {pendingDecisions.length > 0 && (
                <button
                  onClick={async () => {
                    for (const d of pendingDecisions) {
                      await fetch(`/api/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
                    }
                    setPendingDecisions([])
                  }}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition"
                >
                  Release All ({pendingDecisions.length})
                </button>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Applicant</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Decision</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Made By</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pendingDecisions.map((d: any) => (
                  <tr key={d.id} className="hover:bg-muted/50 transition">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {d.domainApplication.application.user.firstName} {d.domainApplication.application.user.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{d.domainApplication.challengeVersion.domain.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                        d.type === 'Accepted' ? 'bg-green-100 text-green-700' :
                        d.type === 'Rejected' ? 'bg-red-100 text-red-700' :
                        d.type === 'Waitlisted' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {d.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{d.madeBy.firstName} {d.madeBy.lastName}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={async () => {
                          setReleasing(d.id)
                          await fetch(`/api/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
                          setPendingDecisions(prev => prev.filter(p => p.id !== d.id))
                          setReleasing(null)
                        }}
                        disabled={releasing === d.id}
                        className="px-3 py-1 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
                      >
                        {releasing === d.id ? 'Releasing...' : 'Release'}
                      </button>
                    </td>
                  </tr>
                ))}
                {pendingDecisions.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground/70">No Final decisions awaiting release.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function CompleteConfirmModal({ cycleId, onClose, onCompleted, onError }: {
  cycleId: string;
  onClose: () => void;
  onCompleted: (forced: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [checking, setChecking] = useState(true);
  const [pendingInterviews, setPendingInterviews] = useState(0);
  const [undecidedApps, setUndecidedApps] = useState(0);
  const [hasBlockers, setHasBlockers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Try without force first to check for blockers
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/cycles/${cycleId}/status`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: 'Completed', force: false }),
      });
      if (res.ok) {
        // No blockers — cycle completed
        onCompleted(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && (body.pendingInterviews > 0 || body.undecidedApplications > 0)) {
        setPendingInterviews(body.pendingInterviews ?? 0);
        setUndecidedApps(body.undecidedApplications ?? 0);
        setHasBlockers(true);
      } else {
        onError(body.error ?? 'Failed to complete cycle.');
      }
      setChecking(false);
    })();
  }, [cycleId]);

  async function forceComplete() {
    setSubmitting(true);
    const res = await fetch(`/api/cycles/${cycleId}/status`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newStatus: 'Completed', force: true }),
    });
    if (res.ok) {
      onCompleted(true);
    } else {
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? 'Failed to force-complete cycle.');
    }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        {checking ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Checking cycle readiness...</p>
          </div>
        ) : hasBlockers ? (
          <>
            <h2 className="text-lg font-semibold text-foreground">Cycle has unfinished work</h2>
            <div className="space-y-2">
              {pendingInterviews > 0 && (
                <div className="flex items-center gap-2 text-sm bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                  <span className="font-semibold text-yellow-800">{pendingInterviews}</span>
                  <span className="text-yellow-700">interview{pendingInterviews !== 1 ? 's' : ''} not yet completed</span>
                </div>
              )}
              {undecidedApps > 0 && (
                <div className="flex items-center gap-2 text-sm bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                  <span className="font-semibold text-yellow-800">{undecidedApps}</span>
                  <span className="text-yellow-700">applicant{undecidedApps !== 1 ? 's' : ''} without a released decision</span>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Resolve these before completing the cycle, or force-close if you're sure.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
              >
                Go back
              </button>
              <button
                onClick={forceComplete}
                disabled={submitting}
                className="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50"
              >
                {submitting ? 'Closing...' : 'Force Close'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function GeneralRubricPicker({ currentRubricVersionId, rubricVersionOptions, locked }: {
  currentRubricVersionId: string | null;
  rubricVersionOptions: any[];
  locked: boolean;
}) {
  const [editing, setEditing] = useState(!currentRubricVersionId);
  const currentRubric = rubricVersionOptions.find((rv: any) => rv.id === currentRubricVersionId);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-3">
      <h3 className="text-sm font-bold text-foreground/80">General Application Rubric</h3>
      <p className="text-xs text-muted-foreground">Reviewers score every application against this rubric (in addition to the per-domain rubric set by domain leads).</p>

      {locked ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span>{currentRubric?.rubric?.name ?? 'Set'} — v{currentRubric?.versionNumber}</span>
          <span className="text-xs text-muted-foreground/70 ml-2">(locked — reviews have started)</span>
        </div>
      ) : currentRubricVersionId && !editing ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentRubric?.rubric?.name ?? 'Set'} — v{currentRubric?.versionNumber}</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Change
          </button>
        </div>
      ) : (
        <Form method="post" className="flex items-end gap-3" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="set-general-rubric" />
          <div className="flex-1">
            <select
              name="rubricVersionId"
              defaultValue={currentRubricVersionId ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No rubric assigned</option>
              {rubricVersionOptions.map((rv: any) => (
                <option key={rv.id} value={rv.id}>
                  {rv.rubric.name} — v{rv.versionNumber}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
          {currentRubricVersionId && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </Form>
      )}
    </div>
  );
}

function GeneralFormPicker({ currentCvId, currentCvName, options, locked }: {
  currentCvId: string | null;
  currentCvName: string | null;
  options: any[];
  locked: boolean;
}) {
  const [editing, setEditing] = useState(!currentCvId);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-3">
      <h3 className="text-sm font-bold text-foreground/80">General Application Form</h3>

      {locked ? (
        currentCvId ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentCvName}</span>
            <span className="text-xs text-muted-foreground/70 ml-2">(locked — cycle is past Draft)</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70">No general form linked.</p>
        )
      ) : currentCvId && !editing ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentCvName}</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Change
          </button>
        </div>
      ) : options.length > 0 ? (
        <Form method="post" className="flex items-end gap-3" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="link-general-form" />
          <div className="flex-1">
            <select
              name="challengeVersionId"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              defaultValue={currentCvId ?? ""}
            >
              <option value="" disabled>Select a general form...</option>
              {options.map((cv: any) => (
                <option key={cv.id} value={cv.id}>
                  {cv.challenge?.name ?? 'Untitled'} ({(cv.questions as any[])?.length ?? 0} questions)
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
          {currentCvId && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </Form>
      ) : (
        <p className="text-xs text-muted-foreground/70">No general forms available. Create a challenge with no domain on the Challenges page first.</p>
      )}
    </div>
  );
}
