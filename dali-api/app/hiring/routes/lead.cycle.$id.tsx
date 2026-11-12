import { useState, useEffect, useCallback } from "react";
import { cn } from "~/lib/cn";
import { hiringKey } from "~/email/lib/registry";
import { EmailEditorModal } from "~/admin/components/EmailTemplatesAdmin";
import { Form, Link, useParams, useLoaderData, useSearchParams, useFetcher } from "react-router";
import { Select, type SelectOption, Tooltip } from "~/components/ui/floating";
import type { Route } from "./+types/lead.cycle.$id";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCycleAdmin } from "~/lib/roles";
import { useCurrentMembers } from "~/hiring/lib/current-members";
import { domainCloseDate } from "~/hiring/lib/domain-windows";
import { defaultTimelineFor, isMemberApplicants } from "~/hiring/lib/applicant-groups";
import { handleMemberSetupIntent } from "~/hiring/lib/cycle-setup.server";
import { FIRST_INTERVIEW_ROUND_ID, delibRounds, hasInterviews as timelineHasInterviews, interviewRoundForTab, interviewRounds as timelineInterviewRounds, parseTimeline, type Timeline } from "~/hiring/lib/cycle-timeline";
import { roundsWithBoards } from "~/hiring/lib/cycle-timeline.server";
import { buildPhaseTabs, resolvePhaseTab } from "~/hiring/lib/cycle-phase-tabs";
import { TargetDomainsCard } from "~/hiring/components/cycle-setup/TargetDomainsCard";
import { ReviewerPoolCard } from "~/hiring/components/cycle-setup/ReviewerPoolCard";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { CONTINUED_INTEREST_SLOT, LATER_INTERVIEW_INVITE_SLOT, decisionSlot, releaseSlot, notificationSlot, type TemplateSlot, type DecisionSlotType, type NotificationSlotType } from "~/hiring/lib/email-variables";
import { loadLeadCycle } from "~/hiring/lib/lead-cycle.server";
import type { InterviewConfig, RoomHoldConflict, CycleReviewer, InterviewRow, PendingInviteRow } from "~/hiring/lib/lead-cycle-types";
import { AVAILABILITY_ORDER, AVAILABILITY_NOTE } from "~/hiring/lib/lead-cycle-types";
import { reassignInterviewer, type ReassignTarget } from "~/hiring/components/lead-cycle/interview-actions";
import { LEAD_CYCLE_ACTIONS, cycleRedirect } from "~/hiring/lib/lead-cycle-actions.server";
import { Modal } from "~/components/Modal";
import { seatEligible, type InterviewerAvailability } from "~/hiring/lib/interviewer-pool";
import { Checkbox } from "~/components/ui/Checkbox";
import { Toggle } from "~/components/ui/Toggle";
import { DateField } from "~/components/ui/DateField";
import { useToast } from "~/components/ui/toast";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import { AlertTriangle, Trash2, Plus, ArrowRight, X, Eye, CheckCircle2, CircleDot, AlertCircle } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { SegmentedTabButtons } from "~/components/ui/SegmentedTabs";
import { buttonClasses } from "~/components/ui/Button";
import { OpenApplicationsConfirmModal } from "~/hiring/components/cycle-setup/OpenApplicationsConfirmModal";
import { TermDatesCard } from "~/hiring/components/cycle-setup/TermDatesCard";
import { ApplicationEventsCard } from "~/hiring/components/cycle-setup/ApplicationEventsCard";
import { AudienceCard } from "~/hiring/components/cycle-setup/AudienceCard";
import { NavSection, SectionNavLayout } from "~/hiring/components/cycle-setup/SectionNav";
import { DomainSubRow, SubRowEmpty, SubRowVersion } from "~/hiring/components/cycle-setup/DomainSubRow";
import { ChallengeLine, NotReadyIcon, type DomainChallenge } from "~/hiring/components/cycle-setup/ChallengeLine";
import { DomainRosterCard } from "~/hiring/components/cycle-setup/DomainRosterCard";
import { TimelineCard } from "~/hiring/components/cycle-setup/TimelineCard";
import { Pill, SetupCard, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { DomainStatusList } from "~/hiring/components/cycle-setup/DomainStatusList";
import { formatVersionLabel } from "~/lib/formatVersion";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { ConfidentialityAgreementPicker } from "~/hiring/components/ConfidentialityAgreementPicker";
import { STATUS_TONES, STATUS_LABELS } from "~/hiring/lib/labels";
import { zonedDayStartUtc, getZonedYMD, formatInTimeZone, APPLICATION_TZ } from "~/lib/timezone";
import { DURATION_OPTIONS, BUFFER_OPTIONS, HOUR_OPTIONS, formatHour, type CoverageData, BookableSlotsCard, FilterSelect, CoverageHeatmap } from "~/hiring/components/lead-cycle/InterviewCoverage";
import { DecisionEmailPreviewModal, RoomHoldConflictModal, CompleteConfirmModal } from "~/hiring/components/lead-cycle/LeadCycleModals";
import { CloseDateNotice, CloseDateCard } from "~/hiring/components/lead-cycle/CloseDateCard";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.cycle?.name;
  return [{ title: `${name || "Cycle"} · Hiring lead · DALI OS` }];
};

export async function loader(args: Route.LoaderArgs) {
  return loadLeadCycle(args);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCycleAdmin(auth.user.sub, params.id))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const actorId = auth.user.sub;

  const cycleRow = await prisma.applicationCycle.findUnique({
    where: { id: params.id },
    select: { applicants: true },
  });
  if (!cycleRow) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  const memberResult = isMemberApplicants(cycleRow.applicants)
    ? await handleMemberSetupIntent(intent, formData, params.id, cycleRow.applicants)
    : null;
  if (memberResult) return memberResult;

  const handler = Object.hasOwn(LEAD_CYCLE_ACTIONS, intent) ? LEAD_CYCLE_ACTIONS[intent] : null;
  if (!handler) return cycleRedirect(request, params.id!);
  return handler({ request, formData, intent, cycleId: params.id!, actorId, applicants: cycleRow.applicants });
}

type DecisionSlice = 'invites' | 'finalize' | 'outcomes'

// `invites` only renders on the round tab that hands off to Interviews, so
// `outcomes` on the Decisions tab takes every Final: an invite finalized after
// the lead has moved past that round would otherwise be releasable nowhere.
export const DECISION_SLICES: Record<DecisionSlice, { title: string; empty: string; include: (d: any) => boolean }> = {
  invites: {
    title: 'Interview invites',
    empty: 'No invites ready to send.',
    include: (d) => d.stage === 'Final' && d.type === 'InvitedToInterview',
  },
  finalize: {
    title: 'Draft decisions',
    empty: 'No drafts to finalize. Close final delibs to create them.',
    include: (d) => d.stage === 'Draft',
  },
  outcomes: {
    title: 'Decisions ready to release',
    empty: 'No decisions awaiting release.',
    include: (d) => d.stage === 'Final',
  },
}

export default function HiringLeadCycleDetails() {
  const toast = useToast()
  const dialog = useDialog()
  const { id: cycleId } = useParams()
  const loaderData = useLoaderData<typeof loader>() as any
  const os = useOsChrome()
  const cycle = loaderData?.cycle
  const memberSetup = loaderData?.memberSetup ?? null
  const isMemberCycle = memberSetup !== null
  const domainsTitle =
    cycle?.applicants === 'LabMembers' ? 'Applicant pool' : isMemberCycle ? 'Target domains' : 'Domains'
  // A domain's challenges, shown on its row only when the cycle has them.
  const challengeFor = (domainId: string): DomainChallenge | null => {
    if (!cycle?.hasChallenges) return null
    const forms = (cycle?.domainChallengeForms ?? [])
      .filter((f: any) => f.domainId === domainId)
      .map((f: any) => ({ id: f.id, formId: f.formId, name: f.form.name, ...f.form.versions?.[0] }))
    const linked = new Set(forms.map((f: any) => f.formId))
    return {
      forms,
      pickable: (loaderData?.allForms ?? []).filter((f: any) => !linked.has(f.id)),
    }
  }

  const timeline: Timeline = parseTimeline(loaderData?.progress?.timeline)
  const rounds = delibRounds(timeline)
  const hasInterviews = timelineHasInterviews(timeline)

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
    bookingNoticeHours: 12,
    timezone: APPLICATION_TZ,
    roomIds: [],
    holdRooms: false,
  })
  const [configSaved, setConfigSaved] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [availableRooms, setAvailableRooms] = useState<{ id: string; name: string }[]>([])
  const [holdConflicts, setHoldConflicts] = useState<RoomHoldConflict[] | null>(null)

  // ── Reviewers state ──
  const [reviewers, setReviewers] = useState<CycleReviewer[]>([])
  const allMembers = useCurrentMembers(!isMemberCycle || hasInterviews)

  // ── Interviewers state ──
  const [interviewers, setInterviewers] = useState<any[]>([])

  // ── Interviews state ──
  const [interviews, setInterviews] = useState<InterviewRow[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([])
  // Per-row id while a Resend invite is in-flight; null when idle.
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)
  const [reopeningId, setReopeningId] = useState<string | null>(null)
  // Filters for the interviews table — domain + status. "all" disables.
  const [interviewDomainFilter, setInterviewDomainFilter] = useState<string>('all')
  const [interviewStatusFilter, setInterviewStatusFilter] = useState<string>('all')
  // Cancelled interviews are hidden by default — they duplicate the
  // "Awaiting Schedule" row for the same applicant and clutter the
  // "what comes next" view.
  const [showCancelledInterviews, setShowCancelledInterviews] = useState<boolean>(false)

  // ── Coverage heatmap state ──
  const [coverage, setCoverage] = useState<CoverageData | null>(null)

  // ── Cycle status ──
  // Hydrate from the loader's statusUpdates so reload renders the correct
  // status on the first paint. loadStatus() re-fetches via /api shortly after
  // mount to pick up any server-side transition (e.g. auto-close) since the
  // loader ran.
  const [cycleStatus, setCycleStatus] = useState<string>(
    cycle?.statusUpdates?.[0]?.newStatus ?? 'Draft'
  )
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [showOpenConfirm, setShowOpenConfirm] = useState(false)

  const STATUS_FLOW = ['Draft', 'Open', 'UnderReview', 'Completed'] as const

  // ── Active tab (URL-synced: deep-links, reload, and back/forward all work) ──
  const [searchParams, setSearchParams] = useSearchParams()
  // Tabs are the timeline's blocks; ?tab= holds the block key (a phase key,
  // or `delib:<id>` for a round).
  const termStart: Date | null = loaderData?.progress?.term ? new Date(loaderData.progress.term.startDate) : null
  const phaseTabs = buildPhaseTabs(
    timeline,
    { hasChallenges: !!cycle?.hasChallenges },
    loaderData?.progress?.done ?? {},
    termStart,
  )
  const tab = resolvePhaseTab(searchParams.get('tab'), phaseTabs, timeline)
  const activeRound = rounds.find(r => `delib:${r.id}` === tab) ?? null
  // The Interviews round on screen: its own tab, else the first round (whose
  // roster lives on Review).
  const activeInterviewRound = interviewRoundForTab(timeline, tab)
  const viewRoundId = activeInterviewRound?.id ?? FIRST_INTERVIEW_ROUND_ID
  const laterInterviewRoundIds = new Set(
    timelineInterviewRounds(timeline).filter(r => r.index > 0).map(r => r.id),
  )
  // A decision's email: invites to a later round send their own.
  const slotFor = (d: { type: string; interviewRoundId?: string | null }): TemplateSlot =>
    releaseSlot(d.type as DecisionSlotType, laterInterviewRoundIds.has(d.interviewRoundId ?? ''))
  const setTab = useCallback((next: string) => {
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev)
      sp.set('tab', next)
      return sp
    }, { replace: true, preventScrollReset: true })
  }, [setSearchParams])

  // ── Decisions state ──
  const [pendingDecisions, setPendingDecisions] = useState<any[]>(loaderData?.pendingDecisions ?? [])
  const [releasing, setReleasing] = useState<string | null>(null)
  const [releasingAll, setReleasingAll] = useState(false)

  // Release a single decision behind a confirm — sends an irreversible email.
  // An Accept that would also close a still-open sibling domain application
  // (acceptPreemptionWarning) gets a stronger warning naming that domain.
  async function confirmReleaseOne(d: any) {
    if (releasing === d.id) return
    const warning = acceptPreemptionWarning(d)
    if (
      !(await dialog.confirm(
        warning
          ? { title: warning.title, description: warning.description, confirmLabel: "Accept and close", tone: "destructive" }
          : {
              title: `Release this decision to ${d.domainApplication.application.user.firstName}?`,
              description: "This emails the applicant their decision. It can't be undone.",
              confirmLabel: "Release",
              tone: "destructive",
            },
      ))
    )
      return
    setReleasing(d.id)
    await fetch(`/api/hiring/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
    setPendingDecisions(prev => prev.filter(p => p.id !== d.id))
    setReleasing(null)
  }
  // Member cycles have no domain-lead finalize step, so the lead promotes
  // Draft decisions to Final here before releasing them.
  const [finalizing, setFinalizing] = useState(false)
  async function finalizeDecisions(ids: string[]) {
    if (finalizing || ids.length === 0) return
    setFinalizing(true)
    try {
      for (const id of ids) {
        const res = await fetch(`/api/hiring/decisions/${id}/finalize`, { method: 'POST', credentials: 'include' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body.error ?? `Couldn't finalize (HTTP ${res.status}).`)
          return
        }
        const newFinal = await res.json()
        setPendingDecisions(prev => prev.map(p => (p.id === id ? { ...p, id: newFinal.id, stage: 'Final' } : p)))
      }
    } finally {
      setFinalizing(false)
    }
  }
  const [previewDecisionId, setPreviewDecisionId] = useState<string | null>(null)
  const [decisionDomainFilter, setDecisionDomainFilter] = useState<string>('all')
  const [decisionTypeFilter, setDecisionTypeFilter] = useState<string>('all')

  // ── Loaders (extracted so handlers can refetch after mutations) ──
  const loadStatus = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/status`, { credentials: 'include' })
      if (!r.ok) return
      const data = await r.json()
      if (data) setCycleStatus(data.currentStatus)
    } catch {}
  }, [cycleId])

  const loadConfig = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interview-config?round=${viewRoundId}`, { credentials: 'include' })
      if (!r.ok) return
      const data = await r.json()
      if (data) {
        setConfig({
          ...data,
          interviewStartDate: data.interviewStartDate?.slice(0, 10) ?? '',
          interviewEndDate: data.interviewEndDate?.slice(0, 10) ?? '',
          roomIds: (data.rooms ?? []).map((room: { id: string }) => room.id),
          holdRooms: !!data.holdRooms,
        })
      }
    } catch {}
  }, [cycleId, viewRoundId])

  const loadRooms = useCallback(async () => {
    try {
      const r = await fetch('/api/rooms', { credentials: 'include' })
      if (!r.ok) return
      const data = await r.json()
      setAvailableRooms(data?.rooms ?? [])
    } catch {}
  }, [])

  const loadReviewers = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/reviewers`, { credentials: 'include' })
      setReviewers(r.ok ? await r.json() : [])
    } catch {}
  }, [cycleId])

  const loadInterviewers = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interviewers?round=${viewRoundId}`, { credentials: 'include' })
      setInterviewers(r.ok ? await r.json() : [])
    } catch {}
  }, [cycleId, viewRoundId])

  const loadInterviews = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interviews?round=${viewRoundId}`, { credentials: 'include' })
      if (!r.ok) {
        setInterviews([])
        setPendingInvites([])
        return
      }
      const body = await r.json()
      // Tolerate the legacy array shape so reverting the API doesn't break
      // the client; new shape returns { interviews, pending }.
      setInterviews(Array.isArray(body) ? body : (body.interviews ?? []))
      setPendingInvites(Array.isArray(body) ? [] : (body.pending ?? []))
    } catch {}
  }, [cycleId, viewRoundId])

  const loadCoverage = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/coverage?round=${viewRoundId}`, { credentials: 'include' })
      setCoverage(r.ok ? await r.json() : null)
    } catch {}
  }, [cycleId, viewRoundId])

  async function advanceStatus(force = false) {
    if (!cycleId) return
    const idx = STATUS_FLOW.indexOf(cycleStatus as any)
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return
    const next = STATUS_FLOW[idx + 1]
    setStatusUpdating(true)
    setStatusError(null)
    try {
      const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: next, force }),
      })
      if (res.ok) {
        setCycleStatus(next)
        // Status transitions can change which interview rows the server returns.
        loadInterviews()
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

  // ── Load data ──
  // Member cycles keep their reviewer pool in the loader; the per-domain
  // roster and everything interview-related only exist for some cycles.
  useEffect(() => {
    if (!cycleId) return
    loadStatus()
    if (!isMemberCycle) loadReviewers()
    if (hasInterviews) {
      loadConfig()
      loadRooms()
      loadInterviewers()
      loadInterviews()
      loadCoverage()
    }
  }, [cycleId, isMemberCycle, hasInterviews, loadStatus, loadConfig, loadRooms, loadReviewers, loadInterviewers, loadInterviews, loadCoverage])

  // An action on this page (e.g. adding a domain's mentors) revalidates the
  // loader but not these client-fetched rosters, so refetch them with it.
  useEffect(() => {
    if (!cycleId) return
    if (!isMemberCycle) loadReviewers()
    if (hasInterviews) loadInterviewers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData])

  // ── Handlers ──

  async function saveConfig(overrideConflicts = false) {
    if (!cycleId) return
    setConfigSaving(true)
    try {
      // Anchor the date inputs at midnight in the cycle's timezone — my-availability and slot generation expect this.
      const toZonedMidnightIso = (ymd: string): string => {
        const [y, m, d] = ymd.split('-').map(Number)
        return zonedDayStartUtc(y, m, d, config.timezone).toISOString()
      }
      const payload = {
        ...config,
        interviewStartDate: config.interviewStartDate
          ? toZonedMidnightIso(config.interviewStartDate)
          : config.interviewStartDate,
        interviewEndDate: config.interviewEndDate
          ? toZonedMidnightIso(config.interviewEndDate)
          : config.interviewEndDate,
        overrideConflicts,
        interviewRoundId: viewRoundId,
      }
      const res = await fetch(`/api/hiring/cycles/${cycleId}/interview-config`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setHoldConflicts(null)
        setConfigSaved(true)
        setTimeout(() => setConfigSaved(false), 2000)
        if (overrideConflicts) {
          const peopleCount = new Set(
            (holdConflicts ?? []).flatMap(c => c.items.map(i => `${i.organizer.firstName} ${i.organizer.lastName}`)),
          ).size
          toast.success(`Rooms held. ${peopleCount} people were told.`)
        }
      } else if (res.status === 409) {
        const data = await res.json().catch(() => null)
        if (data?.conflicts) setHoldConflicts(data.conflicts)
      }
    } finally {
      setConfigSaving(false)
    }
  }

  function keepTheirBookings() {
    setHoldConflicts(null)
    toast.info('Hold not applied')
  }

  async function addReviewer(userId: string, domainId: string) {
    if (!cycleId) return
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, domainId }),
    })
    // The POST row lacks the user/domain relations the list shows; refetch.
    if (res.ok) await loadReviewers()
  }

  async function removeReviewer(reviewerId: string) {
    if (!cycleId) return
    const reviewer = reviewers.find(r => r.id === reviewerId)
    const name = reviewer
      ? (reviewer.user?.firstName && reviewer.user?.lastName
          ? `${reviewer.user.firstName} ${reviewer.user.lastName}`
          : reviewer.user?.daliEmail ?? 'this reviewer')
      : 'this reviewer'
    if (
      !(await dialog.confirm({
        title: `Remove ${name} as a reviewer?`,
        description: 'They will no longer be assignable to applicants in this domain. Any reviews already submitted will be deleted.',
        confirmLabel: 'Remove reviewer',
        tone: 'destructive',
      }))
    )
      return
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setReviewers(prev => prev.filter(r => r.id !== reviewerId))
    }
  }

  async function addInterviewer(userId: string, domainId: string) {
    if (!cycleId) return
    const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, domainId, interviewRoundId: viewRoundId }),
    })
    // POST returns the bare cycleInterviewer row without user/domain
    // relations; refetch so the row matches the server shape exactly.
    if (res.ok) await loadInterviewers()
  }

  async function removeInterviewer(interviewerId: string) {
    if (!cycleId) return
    const interviewer = (interviewers as any[]).find((i: any) => i.id === interviewerId)
    const name = interviewer
      ? (interviewer.user?.firstName && interviewer.user?.lastName
          ? `${interviewer.user.firstName} ${interviewer.user.lastName}`
          : interviewer.user?.daliEmail ?? 'this interviewer')
      : 'this interviewer'
    if (
      !(await dialog.confirm({
        title: `Remove ${name} as an interviewer?`,
        confirmLabel: 'Remove interviewer',
        tone: 'destructive',
      }))
    )
      return
    const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewerId }),
    })
    if (res.ok) {
      setInterviewers(prev => prev.filter(i => i.id !== interviewerId))
    }
  }

  // The pending-decisions list, sliced by phase: invites go out in Review,
  // member cycles finalize Drafts in Final delibs, outcomes release in
  // Decisions. Release and finalize behave the same everywhere.
  function renderDecisions(kind: DecisionSlice) {
    if (loaderData?.confidentialityRequired) {
      return (
        <ConfidentialityGate
          cycleId={cycleId ?? ''}
          reason={loaderData.confidentialityRequired}
          next={`/hiring/lead/cycle/${cycleId}?tab=${tab}`}
        />
      )
    }
    // A round's invites list shows only invites to the Interviews round it feeds.
    const scoped = pendingDecisions.filter(
      (d: any) =>
        DECISION_SLICES[kind].include(d) &&
        (kind !== 'invites' || (d.interviewRoundId ?? FIRST_INTERVIEW_ROUND_ID) === activeRound?.interviewRoundId),
    )
    // A decision can be released once its email is written.
    const isBound = (d: any) => !!loaderData?.hiringEmails?.[slotFor(d)]
    const domainNameOf = (d: any) =>
      d.domainApplication.domain?.name ?? ''
    const availableDomains = Array.from(
      new Set(scoped.map(domainNameOf))
    ).sort()
    const availableTypes = Array.from(
      new Set(scoped.map((d: any) => d.type as string))
    ).sort()
    const filtersActive = decisionDomainFilter !== 'all' || decisionTypeFilter !== 'all'
    const filteredDecisions = scoped.filter((d: any) => {
      if (decisionDomainFilter !== 'all' && domainNameOf(d) !== decisionDomainFilter) return false
      if (decisionTypeFilter !== 'all' && d.type !== decisionTypeFilter) return false
      return true
    })
    const drafts = filteredDecisions.filter((d: any) => d.stage === 'Draft')
    const finals = filteredDecisions.filter((d: any) => d.stage === 'Final')
    const releasable = finals.filter(isBound)
    const skipped = finals.length - releasable.length
    const releaseAll = async () => {
      if (releasingAll) return
      const ids = releasable.map((d: any) => d.id)
      if (ids.length === 0) return
      // Among the releasable Accepts, the ones that would also close a
      // still-open sibling application as AcceptedElsewhere — surfaced once
      // here rather than per-row, so releasing in bulk doesn't skip the warning.
      const preemptions = releasable.filter((d: any) => acceptPreemptionWarning(d) !== null)
      const preemptionNote =
        preemptions.length > 0
          ? ` ${preemptions.length} of these acceptance${preemptions.length === 1 ? '' : 's'} will also close a still-open sibling application: ${joinNames(
              preemptions.map(
                (d: any) =>
                  `${d.domainApplication.application.user.firstName} (${joinNames((d.openSiblingDomains ?? []).map((s: any) => s.name))})`,
              ),
            )}.`
          : ''
      if (
        !(await dialog.confirm({
          title: `Release ${ids.length} decision${ids.length === 1 ? '' : 's'}?`,
          description:
            `This emails ${ids.length === 1 ? 'this applicant' : `all ${ids.length} applicants`} their decision right now. It can't be undone.${preemptionNote}`,
          confirmLabel: `Release ${ids.length}`,
          tone: "destructive",
        }))
      )
        return
      setReleasingAll(true)
      for (const id of ids) {
        await fetch(`/api/hiring/decisions/${id}/release`, { method: 'POST', credentials: 'include' })
      }
      const releasedIds = new Set(ids)
      setPendingDecisions(prev => prev.filter(p => !releasedIds.has(p.id)))
      setReleasingAll(false)
    }
    const rowActions = (d: any) => {
      if (d.stage === 'Draft') {
        return (
          <button
            type="button"
            onClick={() => finalizeDecisions([d.id])}
            disabled={finalizing}
            className={buttonClasses('secondary', 'sm')}
          >
            Finalize
          </button>
        )
      }
      const hasBinding = isBound(d)
      return (
        <>
          <Tooltip content="Preview email">
            <button
              type="button"
              onClick={() => setPreviewDecisionId(d.id)}
              className="os-icon-btn"
              aria-label="Preview email"
            >
              <Eye className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content={!hasBinding ? `Write this decision's email on Setup first.` : null} variant="rich">
            <span>
              <button
                type="button"
                onClick={() => confirmReleaseOne(d)}
                disabled={releasing === d.id || releasingAll || !hasBinding}
                className={buttonClasses('primary', 'sm')}
              >
                {releasing === d.id ? 'Releasing…' : 'Release'}
              </button>
            </span>
          </Tooltip>
        </>
      )
    }
    const typeTone = (type: string) =>
      type === 'Accepted' ? 'success' : type === 'Waitlisted' ? 'warning' : type === 'Rejected' ? 'neutral' : 'accent'
    const showDomainFilter = availableDomains.length > 1
    const showTypeFilter = availableTypes.length > 1
    return (
    <>
      <SetupCard
        title={DECISION_SLICES[kind].title}
        description={
          scoped.length === 0
            ? DECISION_SLICES[kind].empty
            : filtersActive
              ? `Showing ${filteredDecisions.length} of ${scoped.length}.`
              : `${scoped.length} waiting.`
        }
        action={
          <>
            {drafts.length > 0 && (
              <button
                type="button"
                onClick={() => finalizeDecisions(drafts.map((d: any) => d.id))}
                disabled={finalizing}
                className={buttonClasses('secondary', 'md')}
              >
                {finalizing ? 'Finalizing…' : `Finalize all (${drafts.length})`}
              </button>
            )}
            {finals.length > 0 && (
              <Tooltip content={skipped > 0 ? `${skipped} skipped, no email written` : null}>
                <span>
                  <button
                    type="button"
                    onClick={releaseAll}
                    disabled={releasable.length === 0 || releasingAll}
                    className={buttonClasses('primary', 'md')}
                  >
                    {releasingAll ? 'Releasing…' : `Release ${filtersActive ? 'shown' : 'all'} (${releasable.length})`}
                  </button>
                </span>
              </Tooltip>
            )}
          </>
        }
      >
        {(showDomainFilter || showTypeFilter) && (
          <div className="flex flex-wrap items-center gap-2">
            {showDomainFilter &&
              <FilterSelect label="Domain" value={decisionDomainFilter} onChange={setDecisionDomainFilter} allLabel="All domains" values={availableDomains} />}
            {showTypeFilter &&
              <FilterSelect label="Decision" value={decisionTypeFilter} onChange={setDecisionTypeFilter} allLabel="All decisions" values={availableTypes} />}
            {filtersActive && (
              <button
                type="button"
                onClick={() => { setDecisionDomainFilter('all'); setDecisionTypeFilter('all') }}
                className={buttonClasses('ghost', 'sm')}
              >
                Clear
              </button>
            )}
          </div>
        )}
        {scoped.length > 0 && (
          <div className="flex flex-col gap-2">
            {filteredDecisions.map((d: any) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {d.domainApplication.application.user.firstName} {d.domainApplication.application.user.lastName}
                  </span>
                  <span className="text-sm text-os-grey">
                    {[domainNameOf(d), `by ${d.madeBy.firstName} ${d.madeBy.lastName}`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {kind !== 'invites' && <Pill dot={typeTone(d.type)}>{d.type}</Pill>}
                  {d.stage === 'Draft' && <Pill>Draft</Pill>}
                  {rowActions(d)}
                </div>
              </div>
            ))}
            {filteredDecisions.length === 0 && (
              <p className={cn(os.bodyText, 'py-3 text-center')}>No decisions match these filters.</p>
            )}
          </div>
        )}
      </SetupCard>
      {previewDecisionId && (() => {
        const d = scoped.find((x: any) => x.id === previewDecisionId)
        if (!d) return null
        return (
          <DecisionEmailPreviewModal
            decision={d}
            email={loaderData?.hiringEmails?.[slotFor(d)] ?? null}
            slot={slotFor(d)}
            dates={{
              startTermCode:
                d.domainApplication.application.startTerm?.code ??
                (loaderData?.termOptions ?? []).find((t: any) => t.id === cycle?.termId)?.code ??
                null,
              offerRespondBy: cycle?.offerRespondBy ? new Date(cycle.offerRespondBy) : null,
              waitlistRespondBy: cycle?.waitlistRespondBy ? new Date(cycle.waitlistRespondBy) : null,
            }}
            onClose={() => setPreviewDecisionId(null)}
          />
        )
      })()}
    </>
    )
  }

  // Free time comes from each interviewer's DALI OS calendar, read inside the
  // interview window; there's nothing to read until that window is set.
  const interviewWindowSet = !!config.interviewStartDate && !!config.interviewEndDate
  function availabilityCell(i: any) {
    if (!interviewWindowSet) return <span className="text-muted-foreground">Set the interview window</span>
    const hours = i.availabilityHours ?? 0
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        {hours > 0 ? (
          <span className="text-sm text-os-grey">{hours.toFixed(1)}h free</span>
        ) : (
          <Pill tone="warning">No free time</Pill>
        )}
        {!i.hasCalendar && <Pill tone="warning">No calendar</Pill>}
      </span>
    )
  }

  // Roster pickers: the cycle's own domains, and current lab members by name.
  const rosterDomains = (cycle?.domains ?? []).map((d: any) => ({
    id: d.domainId,
    name: d.domain?.name ?? d.domain?.displayName ?? d.domainId,
  }))
  const personName = (u: any, fallback: string) =>
    (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}` : u?.daliEmail) ?? fallback
  const memberOptions = allMembers.map((m) => ({ id: m.id, name: personName(m, m.daliEmail) }))

  const delibRows = (roundId: string) =>
    (cycle?.domains ?? []).map((d: any) => {
      const state = loaderData?.phaseStatusByDomain?.[d.domainId]?.rounds?.[roundId] ?? 'none'
      return {
        domainId: d.domainId,
        name: d.domain?.name ?? d.domain?.displayName ?? d.domainId,
        done: state === 'closed',
        detail: state === 'closed' ? 'Closed' : state === 'active' ? 'In progress' : 'Not started',
      }
    })

  // Opening is still a status change; the header's action runs the next one.
  const draftChecklistMet = cycleStatus !== 'Draft' || (() => {
    const domains = cycle?.domains ?? []
    const allDomainsReady = domains.length > 0 && domains.every((d: any) => d.isReady)
    // Without challenges the application form is all there is to fill.
    const needsForm = isMemberCycle || !cycle?.hasChallenges
    return !!cycle?.closeDate && allDomainsReady && (!needsForm || !!cycle?.applicationForm)
  })()
  const statusIdx = STATUS_FLOW.indexOf(cycleStatus as any)
  const atTerminal = statusIdx < 0 || statusIdx >= STATUS_FLOW.length - 1
  async function runNextStatus() {
    if (cycleStatus === 'UnderReview') return setShowCompleteConfirm(true)
    if (cycleStatus === 'Draft') return setShowOpenConfirm(true)
    if (
      !(await dialog.confirm({
        title: 'Close applications?',
        description:
          "This stops accepting new applications and moves the cycle to Under Review. Applicants who haven't submitted won't be able to submit.",
        confirmLabel: 'Close applications',
        tone: 'destructive',
      }))
    )
      return
    advanceStatus()
  }
  const nextStatusLabel =
    cycleStatus === 'Draft' ? 'Open applications' : cycleStatus === 'Open' ? 'Close applications' : 'Complete cycle'
  const statusAction = !atTerminal && (
    <Tooltip
      content={!draftChecklistMet ? 'Set the close date, get every domain ready, and add the application form first.' : null}
      variant="rich"
    >
      <span>
        <button
          type="button"
          onClick={runNextStatus}
          disabled={statusUpdating || !draftChecklistMet}
          className={buttonClasses('primary', 'md')}
        >
          {statusUpdating ? 'Updating…' : nextStatusLabel}
          <ArrowRight className="w-4 h-4" aria-hidden />
        </button>
      </span>
    </Tooltip>
  )
  const phaseIcon = { done: CheckCircle2, current: CircleDot, overdue: AlertCircle, upcoming: undefined } as const

  const page = (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className={os.pageTitle}>{cycle?.name ?? 'Cycle'}</h1>
        <Pill dot={STATUS_TONES[cycleStatus] ?? 'neutral'}>{STATUS_LABELS[cycleStatus] ?? cycleStatus}</Pill>
        <div className="ml-auto flex items-center gap-3">
          <PresenceBar />
          {statusAction}
        </div>
      </header>

      <CloseDateNotice />

      {showCompleteConfirm && (
        <CompleteConfirmModal
          cycleId={cycleId!}
          onClose={() => setShowCompleteConfirm(false)}
          onCompleted={(forced) => { setShowCompleteConfirm(false); setCycleStatus('Completed'); loadInterviews(); }}
          onError={(msg) => { setShowCompleteConfirm(false); setStatusError(msg); }}
        />
      )}

      {showOpenConfirm && (
        <OpenApplicationsConfirmModal
          cycleId={cycleId!}
          closeDate={cycle?.closeDate ? new Date(cycle.closeDate) : null}
          onClose={() => setShowOpenConfirm(false)}
          onOpened={() => { setShowOpenConfirm(false); setCycleStatus('Open'); loadInterviews(); }}
          onError={(msg) => { setShowOpenConfirm(false); setStatusError(msg); }}
        />
      )}

      {statusError && (
        <div
          role="alert"
          aria-live="polite"
          aria-atomic="true"
          className="bg-destructive/10 border border-destructive/40 rounded-xl p-4 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-destructive">Couldn't advance cycle status</p>
            <p className="text-sm text-destructive mt-0.5">{statusError}</p>
          </div>
          <button
            onClick={() => setStatusError(null)}
            className="text-destructive hover:text-destructive text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      <SegmentedTabButtons
        label="Phases"
        items={phaseTabs.map(p => ({
          label: p.label,
          icon: phaseIcon[p.status],
          active: p.key === tab,
          onClick: () => setTab(p.key),
        }))}
      />

      {/* Keyed by tab so each tab's nav lists only its own sections. */}
      <SectionNavLayout key={tab} label="Sections">

      {/* ── Setup Tab ── */}
      {tab === 'setup' && (
        <div className="flex flex-col gap-6">
          <NavSection id="term-dates" title="Term and dates">
          <TermDatesCard
            termId={cycle?.termId ?? null}
            termOptions={loaderData?.termOptions ?? []}
            openDate={cycle?.openDate ?? null}
            closeDate={cycle?.originalCloseDate ?? cycle?.closeDate ?? null}
            cycleStatus={cycleStatus}
            startTermIds={cycle?.startTermIds ?? []}
            startTermCandidates={loaderData?.startTermCandidates ?? []}
            showStartTerms={cycle?.applicants === "Students"}
            offerRespondBy={cycle?.offerRespondBy ?? null}
            waitlistRespondBy={cycle?.waitlistRespondBy ?? null}
            showRespondBy={cycle?.applicants !== "LabMembers"}
          />
          </NavSection>

          <NavSection id="audience" title="Audience">
          <AudienceCard
            applicants={cycle.applicants}
            hasChallenges={cycle.hasChallenges}
            cycleStatus={cycleStatus}
            viewerIsAdmin={!!loaderData?.viewerIsAdmin}
          />
          </NavSection>

          {/* Extending the close only makes sense once a close date is set. */}
          {cycle?.closeDate && (
            <NavSection id="extension" title="Deadline extension">
            <CloseDateCard
              cycle={cycle}
              cycleStatus={cycleStatus}
            />
            </NavSection>
          )}

          <NavSection id="events" title="Application events">
          <ApplicationEventsCard
            cycleId={cycle.id}
            events={loaderData?.hiringEvents ?? []}
            announcementTemplateBound={!!loaderData?.hiringEmails?.["notification:ApplicationEventAnnouncement"]}
            recipientCount={loaderData?.announcementRecipientCount ?? 0}
            checkIns={loaderData?.hiringEventCheckIns ?? {}}
          />
          </NavSection>

          <NavSection id="timeline" title="Timeline">
          <TimelineCard
            timeline={timeline}
            roundsWithBoards={loaderData?.roundsWithBoards ?? []}
            cycleStatus={cycleStatus}
            isDefault={JSON.stringify(timeline) === JSON.stringify(defaultTimelineFor(cycle.applicants))}
          />
          </NavSection>

          {/* Domains: Students cycles are set up per domain by domain leads;
              Interns cycles pick target domains here; Lab members cycles hang
              off the single CORE domain linked at creation. */}
          <NavSection id="domains" title={domainsTitle}>
          {cycle?.applicants === 'LabMembers' ? (
            <SetupCard
              title="Applicant pool"
              description="Open to all current lab members. Every application goes to Core."
            />
          ) : isMemberCycle ? (
            <TargetDomainsCard
              cycleDomains={cycle?.domains ?? []}
              eligibleDomains={memberSetup.eligibleDomains}
              challengeFor={challengeFor}
              cycleStatus={cycleStatus}
            />
          ) : (
            <SetupCard
              title="Domains"
            >
              {(cycle?.domains ?? []).length > 0 ? (
                <div className="flex flex-col gap-2">
                  {(cycle?.domains ?? []).map((d: any) => (
                    <DomainOverridePanel
                      key={d.domainId}
                      domain={d}
                      cycleStatus={cycleStatus}
                      cycleCloseDate={cycle?.closeDate ?? null}
                      showRubric={!!cycle?.hasChallenges}
                      challenge={challengeFor(d.domainId)}
                      rubricOptions={loaderData?.domainRubricVersions ?? []}
                      rubricLocked={(loaderData?.reviewedDomainIds ?? []).includes(d.domainId)}
                      domainAddedRecipientCount={loaderData?.domainAddedRecipientCount ?? 0}
                    />
                  ))}
                </div>
              ) : (
                <p className={cn(os.bodyText, 'py-4 text-center')}>No domains added yet.</p>
              )}
              {(cycleStatus === 'Draft' || cycleStatus === 'Open') && (
                <Form method="post" preventScrollReset className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="intent" value="add-domain" />
                  <div className={cn(os.fieldLabel, 'min-w-[14rem] flex-1')}>
                    Add domain
                    <Select
                      name="domainId"
                      defaultValue=""
                      placeholder="Pick a domain"
                      options={(loaderData?.allDomains ?? [])
                        .filter((d: any) => !(cycle?.domains ?? []).some((cd: any) => cd.domainId === d.id))
                        .map((d: any): SelectOption => ({ value: d.id, label: d.name }))}
                      buttonClassName={rowTrigger(os.formTrigger)}
                    />
                  </div>
                  <button type="submit" className={buttonClasses('primary', 'md', 'h-9')}>
                    <Plus className="w-4 h-4" aria-hidden /> Add
                  </button>
                </Form>
              )}
            </SetupCard>
          )}
          </NavSection>

          <NavSection id="general-application" title="General application">
            <GeneralApplicationSection
              cycleStatus={cycleStatus}
              applicationForm={cycle?.applicationForm ?? null}
              allForms={loaderData?.allForms ?? []}
              currentRubricVersionId={cycle?.generalRubricVersionId}
              rubricVersionOptions={loaderData?.rubricVersionOptions ?? []}
              rubricLocked={(loaderData?.cycleApplicationReviewCount ?? 0) > 0}
            />
          </NavSection>

          {/* Reusing a waitlisted application is a student-cycle flow. */}
          {cycle?.applicants === 'Students' && (
            <NavSection id="continued-interest" title="Continued interest">
              <SetupCard
                title="Continued interest"
                description="Returning waitlisters can reuse their waitlisted application and fill out this form with it. Without a form, reuse isn't offered."
              >
                <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
                  <CycleFormRow
                    form={cycle?.continuedInterestForm ?? null}
                    allForms={loaderData?.allForms ?? []}
                    // Each reused application pins the form version it
                    // answered, so a swap only affects reuses started after it.
                    swappable
                    createIntent="create-continued-interest-form"
                    setIntent="set-continued-interest-form"
                    ariaLabel="Continued interest form"
                  />
                </div>
              </SetupCard>
            </NavSection>
          )}





          {/* Blind review */}
          <NavSection id="blind-review" title="Blind review">
          <BlindReviewToggle anonymizeReview={cycle?.anonymizeReview ?? true} />
          </NavSection>

          {/* Confidentiality Agreement */}
          <NavSection id="confidentiality" title="Confidentiality agreement">
          <ConfidentialityAgreementPicker
            currentBinding={loaderData?.currentConfidentialityBinding ?? null}
            agreementOptions={loaderData?.confidentialityAgreementOptions ?? []}
            signatures={loaderData?.confidentialitySignatures ?? []}
          />
          </NavSection>

          {/* Decision-release email bindings */}
          <NavSection id="decision-emails" title="Decision emails">
          <EmailStatusSection
            title="Decision emails"
            description="The email each released decision sends."
            hiringEmails={loaderData?.hiringEmails ?? {}}
            canEdit={!!loaderData?.viewerIsCore}
            slots={[
              ...DECISION_EMAIL_SLOTS.filter(
                (slot) => hasInterviews || slot.type !== "InvitedToInterview",
              ).map((slot) => ({ ...slot, templateSlot: decisionSlot(slot.type) })),
              ...(laterInterviewRoundIds.size > 0 ? [LATER_INTERVIEW_INVITE_EMAIL_SLOT] : []),
              ...(cycle?.applicants === 'Students' ? [CONTINUED_INTEREST_EMAIL_SLOT] : []),
            ]}
          />
          </NavSection>

          {/* Non-decision notification email bindings. Application slots fire
              from the student portal; interview slots only with interviews. */}
          {(!isMemberCycle || hasInterviews) && (
            <NavSection id="notification-emails" title="Notification emails">
            <EmailStatusSection
              title="Notification emails"
              description="The email each notification sends."
              hiringEmails={loaderData?.hiringEmails ?? {}}
              canEdit={!!loaderData?.viewerIsCore}
              slots={NOTIFICATION_EMAIL_SLOTS.filter((slot) =>
                slot.type.startsWith('Interview') ? hasInterviews : !isMemberCycle,
              ).map((slot) => ({ ...slot, templateSlot: notificationSlot(slot.type) }))}
            />
            </NavSection>
          )}
        </div>
      )}


      {/* ── Interviews Tab — config, then schedule, then coverage ── */}
      {activeInterviewRound && (
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
      )}
      {activeInterviewRound && (
      <NavSection id="schedule" title="Schedule">
      {loaderData?.confidentialityRequired ? (
        <ConfidentialityGate
          cycleId={cycleId ?? ''}
          reason={loaderData.confidentialityRequired}
          next={`/hiring/lead/cycle/${cycleId}?tab=${tab}`}
        />
      ) : (() => {
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
        const reminderTemplateBound = !!loaderData?.hiringEmails?.['notification:InterviewInviteReminder']
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
        async function changeLocation(interview: any, newRoomId: string) {
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
        const reassign = (interview: any, a: any, to: ReassignTarget) =>
          reassignInterviewer({
            interview,
            assignment: a,
            to,
            dialog,
            toast,
            refresh: () => Promise.all([loadInterviews(), loadInterviewers(), loadCoverage()]),
          })
        async function cancelInterview(interview: any) {
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
                          .filter((a: any) => a.status === 'Active')
                          .map((a: any) => {
                            const m = a.cycleInterviewer.user
                            const name = m.firstName && m.lastName
                              ? `${m.firstName} ${m.lastName}`
                              : m.daliEmail ?? '?'
                            const roleLabel = a.role === 'InDomain' ? a.cycleInterviewer.domain.name : 'Cross'
                            const candidates = seatEligible(interviewers as any[], {
                              role: a.role,
                              applicantDomainId: interview.domainApplication.domainId,
                              seatedUserIds: interview.assignments
                                .filter((s: any) => s.status === 'Active')
                                .map((s: any) => s.cycleInterviewer.userId),
                            })
                              .map((i: any) => {
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
            for (const i of interviewers as any[]) {
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
        )
      })()}
      </NavSection>
      )}


      {/* ── Review: progress, delibs round, interview schedule, invites ── */}
      {/* ── Review: the review team, then review progress ── */}
      {tab === 'review' && isMemberCycle && (
        <NavSection id="reviewers" title="Reviewer pool">
        <ReviewerPoolCard
          reviewers={memberSetup.reviewerPool}
          members={memberSetup.members}
          hasDomains={(cycle?.domains ?? []).length > 0}
          canResetToDefault={cycle?.applicants === 'LabMembers'}
        />
        </NavSection>
      )}
      {tab === 'review' && !isMemberCycle && (
        <NavSection id="reviewers" title="Reviewers">
          <DomainRosterCard
            title="Reviewers"
            description="Who reads each domain's applications."
            role="reviewer"
            mentors
            domains={rosterDomains}
            members={memberOptions}
            people={reviewers.map((r: any) => ({
              id: r.id,
              userId: r.userId ?? r.user?.id,
              domainId: r.domainId ?? r.domain?.id,
              name: personName(r.user, 'Reviewer'),
            }))}
            onAdd={addReviewer}
            onRemove={(p) => removeReviewer(p.id)}
          />
        </NavSection>
      )}
      {/* The first round's roster is set on Review; later rounds bring their own. */}
      {((tab === 'review' && hasInterviews) || (activeInterviewRound && activeInterviewRound.index > 0)) && (
        <NavSection id="interviewers" title="Interviewers">
          <DomainRosterCard
            title="Interviewers"
            description={
              interviewWindowSet
                ? `${interviewers.filter((i: any) => (i.availabilityHours ?? 0) > 0).length} of ${interviewers.length} have free time on their calendar.`
                : 'Free time shows once the interview window is set.'
            }
            role="interviewer"
            mentors={!isMemberCycle}
            domains={rosterDomains}
            members={memberOptions}
            people={(interviewers as any[]).map((i: any) => ({
              id: i.id,
              userId: i.userId,
              domainId: i.domainId ?? i.domain?.id,
              name: personName(i.user, 'Interviewer'),
              detail: availabilityCell(i),
            }))}
            onAdd={addInterviewer}
            onRemove={(p) => removeInterviewer(p.id)}
            interviewRoundId={viewRoundId}
          />
        </NavSection>
      )}
      {tab === 'review' && (
        <NavSection id="review-progress" title="Review progress">
        <DomainStatusList
          title="Review progress"
          rows={(cycle?.domains ?? []).map((d: any) => {
            const r = loaderData?.phaseStatusByDomain?.[d.domainId]?.reviews ?? { assigned: 0, submitted: 0 }
            return {
              domainId: d.domainId,
              name: d.domain?.name ?? d.domainId,
              done: r.assigned > 0 && r.submitted === r.assigned,
              detail: r.assigned === 0 ? 'No reviews assigned' : `${r.submitted} of ${r.assigned} submitted`,
            }
          })}
        />
        </NavSection>
      )}
      {/* ── A delib round: its boards, then what it hands on ── */}
      {activeRound && (
        <NavSection id="round-boards" title={activeRound?.label ?? 'Boards'}>
        <DomainStatusList
          title={activeRound.label}
          description={
            isMemberCycle && activeRound.isFinal
              ? undefined
              : 'Domain leads run delibs from their domain page.'
          }
          rows={delibRows(activeRound.id)}
        />
        </NavSection>
      )}
      {activeRound?.leadsToInterviews && (
        <NavSection id="invites" title="Interview invites">{renderDecisions('invites')}</NavSection>
      )}
      {activeRound?.isFinal && isMemberCycle && (
        <NavSection id="finalize" title="Draft decisions">{renderDecisions('finalize')}</NavSection>
      )}

      {/* ── Decisions ── */}
      {/* Drafts first: they are the ones still needing a lead's hand. Skipped
          when the round context above is already showing this same list, so a
          member cycle mid-final-round doesn't render it twice. */}
      {tab === 'decisions' && !(activeRound?.isFinal && isMemberCycle) && (
        <NavSection id="finalize" title="Draft decisions">{renderDecisions('finalize')}</NavSection>
      )}
      {tab === 'decisions' && (
        <NavSection id="release" title="Decisions to release">{renderDecisions('outcomes')}</NavSection>
      )}
      {tab === 'decisions' && cycleStatus === 'UnderReview' && (
        <NavSection id="complete" title="Complete the cycle">
        <section className={`${os.panel} ${os.panelPad} flex flex-wrap items-center justify-between gap-3`}>
          <div className="flex flex-col gap-1">
            <h3 className={os.sectionTitle}>Complete the cycle</h3>
            <p className={os.bodyText}>Once every decision is out, mark the cycle complete.</p>
          </div>
          <button type="button" onClick={() => setShowCompleteConfirm(true)} className={buttonClasses('primary', 'md')}>
            Complete cycle
          </button>
        </section>
        </NavSection>
      )}
      </SectionNavLayout>
    </div>
  )

  const collabToken = loaderData?.collabToken as string | null | undefined
  const currentUserId = loaderData?.currentUserId as string | undefined
  const presenceUserName = (loaderData?.presenceUserName as string | undefined) ?? ''
  const presencePhotoUrl = (loaderData?.presencePhotoUrl as string | null | undefined) ?? null
  const presenceSubtitle = (loaderData?.presenceSubtitle as string | null | undefined) ?? null
  return collabToken ? (
    <PresenceProvider
      pageId={`cycle:${cycleId}`}
      token={collabToken}
      userName={presenceUserName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
      {page}
    </PresenceProvider>
  ) : (
    page
  )
}

function BlindReviewToggle({ anonymizeReview }: { anonymizeReview: boolean }) {
  return (
    <SetupCard
      title="Blind review"
    >
      <Form method="post" preventScrollReset>
        <input type="hidden" name="intent" value="set-anonymize-review" />
        <Toggle
          name="anonymizeReview"
          tone="os"
          defaultChecked={anonymizeReview}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded-os-item bg-os-well px-4 py-3"
          label={anonymizeReview ? "On" : "Off"}
          description={anonymizeReview ? "Everyone sees “Applicant N” until their domain releases interviews or closes its first delib." : "Everyone sees real names."}
        />
      </Form>
    </SetupCard>
  );
}

// A form bound to the cycle itself (the general application, the continued
// interest form): what's bound, Create when nothing is, and a swap while the
// cycle allows one.
function CycleFormRow({
  form,
  allForms,
  swappable,
  createIntent,
  setIntent,
  ariaLabel,
}: {
  form: { id: string; name: string } | null;
  allForms: { id: string; name: string }[];
  swappable: boolean;
  createIntent: string;
  setIntent: string;
  ariaLabel: string;
}) {
  const os = useOsChrome();
  const formFetcher = useFetcher();
  const formBusy = formFetcher.state !== "idle";
  const [pickingForm, setPickingForm] = useState(false);
  const small = buttonClasses("secondary", "sm");

  return (
    <DomainSubRow
      label="Form"
      value={
        form ? (
          <Link to={`/forms/edit/${form.id}`} className="min-w-0 max-w-full truncate text-os-accent hover:underline" title={form.name}>
            {form.name}
          </Link>
        ) : (
          <SubRowEmpty>None yet</SubRowEmpty>
        )
      }
      action={
        !pickingForm && (
          <>
            {!form && (
              <button
                type="button"
                disabled={formBusy}
                onClick={() => formFetcher.submit({ intent: createIntent }, { method: "post" })}
                className={small}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden /> {formBusy ? "Creating…" : "Create form"}
              </button>
            )}
            {swappable && allForms.length > 0 && (
              <button type="button" onClick={() => setPickingForm(true)} className={small}>
                Use a different form
              </button>
            )}
          </>
        )
      }
      editor={
        swappable &&
        pickingForm && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[14rem] flex-1">
              <Select
                ariaLabel={ariaLabel}
                defaultValue={form?.id ?? ""}
                placeholder="Pick a form"
                onChange={(id) => {
                  setPickingForm(false);
                  if (!id || id === form?.id) return;
                  formFetcher.submit({ intent: setIntent, formId: id }, { method: "post" });
                }}
                options={allForms.map((f) => ({ value: f.id, label: f.name }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </div>
            <button type="button" onClick={() => setPickingForm(false)} className={small}>
              Cancel
            </button>
          </div>
        )
      }
    />
  );
}

// The general application: the form every applicant fills and the rubric
// every application is scored on, as two rows shaped like a domain row (label,
// what's bound, then small actions).
function GeneralApplicationSection({
  cycleStatus,
  applicationForm,
  allForms,
  currentRubricVersionId,
  rubricVersionOptions,
  rubricLocked,
}: {
  cycleStatus: string;
  applicationForm: { id: string; name: string } | null;
  allForms: { id: string; name: string }[];
  currentRubricVersionId: string | null;
  rubricVersionOptions: any[];
  rubricLocked: boolean;
}) {
  const os = useOsChrome();
  // Opens on demand only: an auto-open editor under an empty value repeated
  // "Rubric" / "No rubric" twice.
  const [editingRubric, setEditingRubric] = useState(false);

  const rubricVersion = (rv: any) => ({
    name: rv.rubric?.name ?? "Rubric",
    versionNumber: rv.versionNumber,
    createdAt: rv.createdAt,
    createdBy: rv.createdBy,
  });
  const currentRubric = rubricVersionOptions.find((rv: any) => rv.id === currentRubricVersionId);
  const small = buttonClasses("secondary", "sm");

  return (
    <SetupCard title="General application">
      {/* Same line anatomy as a domain's Challenge and Rubric lines. */}
      <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
        <CycleFormRow
          form={applicationForm}
          allForms={allForms}
          swappable={cycleStatus === "Draft"}
          createIntent="create-application-form"
          setIntent="set-application-form"
          ariaLabel="Application form"
        />
        <DomainSubRow
          label="Rubric"
          value={
            currentRubric ? (
              <SubRowVersion version={rubricVersion(currentRubric)} />
            ) : (
              <SubRowEmpty>None yet</SubRowEmpty>
            )
          }
          action={
            rubricLocked ? (
              <Pill>Locked, reviews started</Pill>
            ) : (
              !editingRubric && (
                <button type="button" onClick={() => setEditingRubric(true)} className={small}>
                  {currentRubric ? "Change" : "Set rubric"}
                </button>
              )
            )
          }
          editor={
            !rubricLocked &&
            editingRubric && (
              <Form
                method="post"
                preventScrollReset
                className="flex flex-wrap items-center gap-2"
                onSubmit={() => setEditingRubric(false)}
              >
                <input type="hidden" name="intent" value="set-general-rubric" />
                <div className="min-w-[14rem] flex-1">
                  <Select
                    name="rubricVersionId"
                    ariaLabel="General application rubric"
                    defaultValue={currentRubricVersionId ?? ""}
                    placeholder="Pick a rubric"
                    options={[
                      { value: "", label: "No rubric" },
                      ...rubricVersionOptions.map((rv: any): SelectOption => ({ value: rv.id, label: formatVersionLabel(rubricVersion(rv)) })),
                    ]}
                    buttonClassName={rowTrigger(os.formTrigger)}
                  />
                </div>
                <button type="submit" className={buttonClasses("primary", "sm")}>
                  Save
                </button>
                <button type="button" onClick={() => setEditingRubric(false)} className={small}>
                  Cancel
                </button>
              </Form>
            )
          }
        />
      </div>
    </SetupCard>
  );
}

function toYmd(d: Date | string | null): string {
  if (!d) return '';
  const { year, month, day } = getZonedYMD(new Date(d), APPLICATION_TZ);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatMonD(d: Date | string | null): string {
  if (!d) return '';
  return formatInTimeZone(new Date(d), APPLICATION_TZ, { month: 'short', day: 'numeric' });
}

function joinNames(names: string[]): string {
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);
}

// An Accept decision closes every other still-selected, undecided sibling
// DomainApplication as AcceptedElsewhere (api.decisions.$id.release.ts). When
// the loader found such a sibling still open (openSiblingDomains, from
// accept-preemption.server.ts), releasing needs a stronger confirm than the
// default "this emails the applicant" one. Null when there's nothing to warn
// about.
function acceptPreemptionWarning(d: any): { title: string; description: string } | null {
  const siblings: { name: string; closeDate: Date | string | null }[] = d.openSiblingDomains ?? [];
  if (d.type !== 'Accepted' || siblings.length === 0) return null;
  const firstName = d.domainApplication.application.user.firstName;
  const names = siblings.map((s) => s.name);
  const nounPhrase =
    siblings.length > 1
      ? `${joinNames(
          siblings.map((s) => (s.closeDate ? `${s.name} (until ${formatMonD(s.closeDate)})` : s.name)),
        )} applications`
      : `${siblings[0].name} application${siblings[0].closeDate ? ` until ${formatMonD(siblings[0].closeDate)}` : ''}`;
  const pronoun = siblings.length > 1 ? 'them' : 'it';
  return {
    title: `Accept and close ${joinNames(names)}?`,
    description: `${firstName} can still edit their ${nounPhrase}. Accepting here closes ${pronoun} as placed elsewhere. This can't be undone.`,
  };
}

function DomainOverridePanel({
  domain,
  cycleStatus,
  cycleCloseDate,
  showRubric,
  challenge,
  rubricOptions,
  rubricLocked,
  domainAddedRecipientCount,
}: {
  domain: any;
  cycleStatus: string;
  /** The cycle's own close date, for the "Same as cycle" label when this domain inherits it. */
  cycleCloseDate: Date | string | null;
  /** The per-domain rubric scores the challenge; hidden when there is none. */
  showRubric: boolean;
  /** This domain's challenges; null when the cycle has none. */
  challenge: DomainChallenge | null;
  rubricOptions: any[];
  rubricLocked: boolean;
  /** How many applicants "Email applicants" would reach — cycle-wide, not per-domain. */
  domainAddedRecipientCount: number;
}) {
  const [showRubricPreview, setShowRubricPreview] = useState(false);

  const isReady: boolean = !!domain.isReady;
  // A domain staged into an Open cycle stays editable until it's marked ready,
  // which is what publishes it to applicants (canEditDomainSetup).
  const staged = cycleStatus === 'Open' && !isReady;
  const setupEditable = cycleStatus === 'Draft' || staged;
  const readyLocked = !setupEditable;
  // Unlike the rest of this panel's setup, the close date can move any time
  // the cycle is still taking or reviewing changes — a lead may need to give
  // one domain more (or less) time after it's already live to applicants.
  const closeDateEditable = cycleStatus === 'Draft' || cycleStatus === 'Open';
  const effectiveCloseDate = domainCloseDate({ closeDate: domain.closeDate }, { closeDate: cycleCloseDate });

  const closeFetcher = useFetcher<{ error?: string }>();
  const [editingClose, setEditingClose] = useState(false);
  const [closeValue, setCloseValue] = useState(toYmd(domain.closeDate));
  useEffect(() => { setCloseValue(toYmd(domain.closeDate)); }, [domain.closeDate]);
  useEffect(() => {
    if (closeFetcher.state === 'idle' && !closeFetcher.data?.error) setEditingClose(false);
  }, [closeFetcher.state, closeFetcher.data]);

  const [selectedRubricId, setSelectedRubricId] = useState(domain.rubricVersionId ?? '');
  // Like the Challenge line, the rubric shows what's set and opens a picker on demand.
  const [editingRubric, setEditingRubric] = useState(false);
  useEffect(() => { setSelectedRubricId(domain.rubricVersionId ?? ''); }, [domain.rubricVersionId]);

  const currentRubric = rubricOptions.find((rv: any) => rv.id === selectedRubricId);
  const rubricVersion = (rv: any) => ({
    name: rv.rubric?.name ?? 'Rubric',
    versionNumber: rv.versionNumber,
    createdAt: rv.createdAt,
    createdBy: rv.createdBy,
  });

  const os = useOsChrome();
  const confirmSubmit = useConfirmSubmit();
  const domainName = domain.domain?.name ?? domain.domainId;
  const previewButton = (
    <Tooltip content="Preview">
      <button
        type="button"
        onClick={() => setShowRubricPreview(true)}
        aria-label="Preview"
        className={buttonClasses('secondary', 'sm', 'px-2')}
      >
        <Eye className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );

  return (
    <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!isReady && <NotReadyIcon />}
          <span className="text-sm font-semibold text-foreground">{domainName}</span>
          {staged && <Pill tone="warning">Not visible to applicants yet</Pill>}
        </div>
        <div className="flex items-center gap-1">
          {!readyLocked && (
            <Form
              method="post"
              preventScrollReset
              className="inline"
              onSubmit={confirmSubmit(
                isReady
                  ? {
                      title: `Unmark ${domainName} as ready?`,
                      description:
                        'It goes back to "not ready" until the domain lead (or a hiring lead) marks it ready again.',
                      confirmLabel: 'Unmark ready',
                    }
                  : staged
                    ? {
                        title: `Open ${domainName} to applicants?`,
                        description:
                          'The cycle is already open. Marking this domain ready publishes it: applicants can pick it from now until its close date.',
                        confirmLabel: 'Open domain',
                      }
                    : {
                        title: `Mark ${domainName} ready on the domain lead's behalf?`,
                        description:
                          'Use this when the domain lead is unavailable and the cycle needs to advance.',
                        confirmLabel: 'Force ready',
                      },
              )}
            >
              <input
                type="hidden"
                name="intent"
                value={isReady ? 'hl-force-unmark-ready' : 'hl-force-mark-ready'}
              />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <input type="hidden" name="confirm" value="true" />
              <button type="submit" className={buttonClasses(isReady ? 'ghost' : 'secondary', 'sm')}>
                {isReady ? 'Unmark ready' : 'Force ready'}
              </button>
            </Form>
          )}
          {cycleStatus === 'Open' && isReady && (
            <Form
              method="post"
              preventScrollReset
              className="inline flex items-center gap-1"
              onSubmit={confirmSubmit({
                title: `Email everyone in this cycle about ${domainName}?`,
                description:
                  `Sends to ${domainAddedRecipientCount} applicant${domainAddedRecipientCount === 1 ? '' : 's'}` +
                  (effectiveCloseDate
                    ? `, telling them ${domainName} is open and closes ${formatMonD(effectiveCloseDate)}.`
                    : `, telling them ${domainName} is open.`) +
                  ' One-time: resending only reaches anyone who missed it the first time.',
                confirmLabel: 'Send',
              })}
            >
              <input type="hidden" name="intent" value="notify-domain-added" />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <input type="hidden" name="confirm" value="true" />
              <button type="submit" className={buttonClasses('secondary', 'sm')}>
                Email applicants
              </button>
            </Form>
          )}
          {setupEditable && (
            <Form
              method="post"
              preventScrollReset
              className="inline"
              onSubmit={confirmSubmit({
                title: `Remove ${domainName} from this cycle?`,
                description:
                  "Any challenge version linked for this domain is unlinked. Applicants can no longer target it.",
                confirmLabel: 'Remove',
                tone: 'destructive',
              })}
            >
              <input type="hidden" name="intent" value="remove-domain" />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <Tooltip content="Remove domain">
                <button
                  type="submit"
                  className={os.iconBtn}
                  aria-label={`Remove ${domainName}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Tooltip>
            </Form>
          )}
        </div>
      </div>

      {challenge && (
        <ChallengeLine domainId={domain.domainId} challenge={challenge} editable={setupEditable} />
      )}

      <DomainSubRow
        label="Closes"
        value={
          domain.closeDate ? (
            <span>{formatMonD(domain.closeDate)}</span>
          ) : (
            <SubRowEmpty>
              {cycleCloseDate ? `Same as cycle (${formatMonD(cycleCloseDate)})` : "Same as cycle (no date set)"}
            </SubRowEmpty>
          )
        }
        action={
          closeDateEditable &&
          !editingClose && (
            <>
              <button type="button" onClick={() => setEditingClose(true)} className={buttonClasses('secondary', 'sm')}>
                {domain.closeDate ? 'Change' : 'Set'}
              </button>
              {domain.closeDate && (
                <button
                  type="button"
                  disabled={closeFetcher.state !== 'idle'}
                  onClick={() =>
                    closeFetcher.submit(
                      { intent: 'set-domain-close-date', domainId: domain.domainId, closeDate: '' },
                      { method: 'post', preventScrollReset: true },
                    )
                  }
                  className={buttonClasses('ghost', 'sm')}
                >
                  Clear
                </button>
              )}
            </>
          )
        }
        editor={
          closeDateEditable && editingClose ? (
            <closeFetcher.Form method="post" preventScrollReset className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="intent" value="set-domain-close-date" />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <DateField
                mode="date"
                name="closeDate"
                value={closeValue}
                onChange={setCloseValue}
                ariaLabel={`${domainName} closes`}
                className="w-44"
                buttonClassName={rowTrigger(os.formTrigger)}
              />
              <button type="submit" disabled={closeFetcher.state !== 'idle'} className={buttonClasses('primary', 'sm', 'h-9')}>
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setCloseValue(toYmd(domain.closeDate));
                  setEditingClose(false);
                }}
                className={buttonClasses('secondary', 'sm', 'h-9')}
              >
                Cancel
              </button>
              {closeFetcher.data?.error && <p className="w-full text-xs text-destructive">{closeFetcher.data.error}</p>}
            </closeFetcher.Form>
          ) : null
        }
      />

      {showRubric && (
        <DomainSubRow
          label="Rubric"
          value={
            currentRubric ? <SubRowVersion version={rubricVersion(currentRubric)} /> : <SubRowEmpty>None yet</SubRowEmpty>
          }
          action={
            <>
              {rubricLocked && <Pill>Locked, reviews assigned</Pill>}
              {currentRubric && !editingRubric && previewButton}
              {!rubricLocked && !editingRubric && rubricOptions.length > 0 && (
                <button type="button" onClick={() => setEditingRubric(true)} className={buttonClasses('secondary', 'sm')}>
                  {currentRubric ? 'Change' : 'Set rubric'}
                </button>
              )}
            </>
          }
          editor={
            rubricOptions.length === 0 ? (
              <p className={os.bodyText}>No rubric versions yet. Create one in the Library.</p>
            ) : !rubricLocked && editingRubric ? (
              <Form
                method="post"
                preventScrollReset
                className="flex flex-wrap items-end gap-2"
                onSubmit={() => setEditingRubric(false)}
              >
                <input type="hidden" name="intent" value="hl-set-domain-rubric" />
                <input type="hidden" name="domainId" value={domain.domainId} />
                <div className="min-w-[14rem] flex-1">
                  <Select
                    name="rubricVersionId"
                    value={selectedRubricId}
                    onChange={(value) => setSelectedRubricId(value)}
                    placeholder="No rubric"
                    ariaLabel={`Select rubric version for ${domainName}`}
                    options={[
                      { value: "", label: "No rubric" },
                      ...rubricOptions.map((rv: any): SelectOption => ({
                        value: rv.id,
                        label: formatVersionLabel(rubricVersion(rv)),
                      })),
                    ]}
                    buttonClassName={rowTrigger(os.formTrigger)}
                  />
                </div>
                {selectedRubricId && previewButton}
                <button type="submit" className={buttonClasses('primary', 'md', 'h-9')}>
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRubricId(domain.rubricVersionId ?? '');
                    setEditingRubric(false);
                  }}
                  className={buttonClasses('secondary', 'md', 'h-9')}
                >
                  Cancel
                </button>
              </Form>
            ) : null
          }
        />
      )}

      {showRubricPreview && currentRubric && (
        <RubricPreviewModal
          rv={currentRubric}
          onClose={() => setShowRubricPreview(false)}
        />
      )}
    </div>
  );
}

function RubricPreviewModal({ rv, onClose }: { rv: any; onClose: () => void }) {
  const headingId = `rubric-preview-heading-${rv.id}`;
  const criteria: any[] = (rv.criteria as any[]) ?? [];
  return (
    <Modal open onClose={onClose} labelledBy={headingId} containerClassName="bg-card rounded-os-card shadow-xl max-w-lg w-full mx-4 p-5 max-h-[80vh] overflow-y-auto">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id={headingId} className="text-lg font-bold text-foreground">
            {rv.rubric?.name ?? 'Rubric'} — v{rv.versionNumber}
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        {criteria.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 italic">No criteria in this version.</p>
        ) : (
          <div className="space-y-3">
            {criteria.map((c: any) => (
              <div key={c.key} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-foreground">{c.label}</h4>
                  <span className="text-xs text-muted-foreground">Max: {c.maxScore}</span>
                </div>
                {c.description && (
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

const DECISION_EMAIL_SLOTS: ReadonlyArray<{ type: DecisionSlotType; label: string; description: string }> = [
  { type: "Rejected", label: "Rejected", description: "Sent when a rejection is released." },
  { type: "InvitedToInterview", label: "Invited to interview", description: "Sent when an interview invite is released." },
  { type: "Waitlisted", label: "Waitlisted", description: "Sent when an applicant is waitlisted." },
  { type: "Accepted", label: "Accepted", description: "Sent when an offer is released." },
];

const LATER_INTERVIEW_INVITE_EMAIL_SLOT = {
  label: "Invited to a later interview round",
  description: "Sent when an invite to a second or later interview round is released.",
  templateSlot: LATER_INTERVIEW_INVITE_SLOT,
} as const;

const CONTINUED_INTEREST_EMAIL_SLOT = {
  label: "Removed from waitlist",
  description: "Sent when Core removes someone from the waitlist. Invites them to reapply with continued interest.",
  templateSlot: CONTINUED_INTEREST_SLOT,
} as const;

function EmailStatusSection({
  title,
  description,
  slots,
  hiringEmails,
  canEdit,
}: {
  title: string;
  description: string;
  slots: ReadonlyArray<{ label: string; description: string; templateSlot: TemplateSlot }>;
  hiringEmails: Record<string, { subject: string; body: string }>;
  /** The viewer is Core, so a row opens Core's editor on that email. */
  canEdit: boolean;
}) {
  // No editor of its own, on purpose. These emails are shared by every cycle, so
  // editing them belongs to Core, not to whoever happens to administer this
  // cycle. A Core viewer's rows open Core's editor here, in place; for everyone
  // else the Setup tab still answers "is it written?", because releasing a
  // decision with no email written fails.
  const [editing, setEditing] = useState<TemplateSlot | null>(null);
  return (
    <SetupCard title={title} description={description}>
      <div className="flex flex-col gap-2">
        {slots.map((slot) => {
          const email = hiringEmails[slot.templateSlot] ?? null;
          const rowClass = "flex items-start gap-3 rounded-lg border border-border p-3";
          const body = (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{slot.label}</span>
                {email ? null : (
                  <span className="text-xs text-os-amber">
                    No email yet
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{slot.description}</p>
              {email ? (
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  Subject: {email.subject}
                </p>
              ) : null}
            </div>
          );
          return canEdit ? (
            <button
              key={slot.templateSlot}
              type="button"
              onClick={() => setEditing(slot.templateSlot)}
              aria-label={`Edit ${slot.label} email`}
              className={cn(rowClass, "w-full text-left transition-colors hover:bg-muted")}
            >
              {body}
            </button>
          ) : (
            <div key={slot.templateSlot} className={rowClass}>
              {body}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Shared by every cycle.{" "}
          <Link to="/core/communications/email" className="underline">
            See all in Core &rarr; Communications &rarr; Email
          </Link>
          .
        </p>
      </div>
      {editing && (
        <EmailEditorModal templateKey={hiringKey(editing)} onClose={() => setEditing(null)} />
      )}
    </SetupCard>
  );
}

const NOTIFICATION_EMAIL_SLOTS: ReadonlyArray<{ type: NotificationSlotType; label: string; description: string }> = [
  { type: "ApplicationReceived", label: "Application received", description: "Sent when an applicant first submits." },
  { type: "ApplicationExtensionNotice", label: "Deadline extension notice", description: "Sent once to unsubmitted applicants after the original close." },
  { type: "ApplicationEventAnnouncement", label: "Application event announcement", description: "Sent by hand from an event card to everyone who started an application." },
  { type: "DomainAddedNotice", label: "Domain added to an open cycle", description: "Sent by hand from a domain row, once per domain, to everyone with a non-Withdrawn application." },
  { type: "InterviewInviteMentor", label: "Interview invite (interviewer)", description: "Sent when an interview is booked or reassigned." },
  { type: "InterviewInterviewerChanged", label: "Co-interviewer changed (interviewer)", description: "Sent to the interviewer who stays on when the other one changes. Uses the invite above if left empty." },
  { type: "InterviewInviteReminder", label: "Invite reminder (applicant)", description: "Sent by Resend invite when an applicant hasn't booked." },
  { type: "InterviewConfirmedApplicant", label: "Interview confirmed (applicant)", description: "Sent when the applicant books." },
  { type: "InterviewCancelledApplicant", label: "Interview cancelled (applicant)", description: "Sent when the interview is cancelled." },
  { type: "InterviewCancelledByTeamApplicant", label: "Interview cancelled by the team (applicant)", description: "Sent when a hiring lead cancels; tells the applicant to book a new time." },
  { type: "InterviewCancelledInterviewer", label: "Interview cancelled (interviewer)", description: "Sent when an interview is cancelled or reassigned away." },
  { type: "InterviewLocationChanged", label: "Interview location changed", description: "Sent to everyone when the location changes." },
  { type: "InterviewReminderApplicant", label: "Interview reminder (applicant)", description: "Sent 24 hours and 1 hour before the interview." },
  { type: "InterviewReminderInterviewer", label: "Interview reminder (interviewer)", description: "Sent 24 hours and 1 hour before the interview." },
];
