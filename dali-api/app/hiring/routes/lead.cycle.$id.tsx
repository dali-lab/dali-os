import { useState, useCallback } from "react";
import { useParams, useLoaderData, useSearchParams } from "react-router";
import { Tooltip } from "~/components/ui/floating";
import type { Route } from "./+types/lead.cycle.$id";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCycleAdmin } from "~/lib/roles";
import { useCurrentMembers } from "~/hiring/lib/current-members";
import { isMemberApplicants } from "~/hiring/lib/applicant-groups";
import { handleMemberSetupIntent } from "~/hiring/lib/cycle-setup.server";
import { FIRST_INTERVIEW_ROUND_ID, delibRounds, hasInterviews as timelineHasInterviews, interviewRoundForTab, interviewRounds as timelineInterviewRounds, parseTimeline, type Timeline } from "~/hiring/lib/cycle-timeline";
import { buildPhaseTabs, resolvePhaseTab } from "~/hiring/lib/cycle-phase-tabs";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { releaseSlot, type TemplateSlot, type DecisionSlotType } from "~/hiring/lib/email-variables";
import { loadLeadCycle } from "~/hiring/lib/lead-cycle.server";
import { LEAD_CYCLE_ACTIONS, cycleRedirect } from "~/hiring/lib/lead-cycle-actions.server";
import { useDialog } from "~/components/ui/dialog";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, AlertCircle } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { SegmentedTabButtons } from "~/components/ui/SegmentedTabs";
import { buttonClasses } from "~/components/ui/Button";
import { OpenApplicationsConfirmModal } from "~/hiring/components/cycle-setup/OpenApplicationsConfirmModal";
import { NavSection, SectionNavLayout } from "~/hiring/components/cycle-setup/SectionNav";
import { Pill } from "~/components/ui/Pill";
import { DomainStatusList } from "~/hiring/components/cycle-setup/DomainStatusList";
import { STATUS_TONES, STATUS_LABELS } from "~/hiring/lib/labels";
import { CompleteConfirmModal } from "~/hiring/components/lead-cycle/LeadCycleModals";
import { CloseDateNotice } from "~/hiring/components/lead-cycle/CloseDateCard";
import { useLeadCycleData, STATUS_FLOW } from "~/hiring/components/lead-cycle/use-lead-cycle-data";
import { SetupTab } from "~/hiring/components/lead-cycle/SetupTab";
import { ReviewTab, InterviewersSection } from "~/hiring/components/lead-cycle/ReviewTab";
import { InterviewsTab } from "~/hiring/components/lead-cycle/InterviewsTab";
import { DecisionsTab, DecisionList, usePendingDecisions, type DecisionListContext } from "~/hiring/components/lead-cycle/DecisionsTab";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = data && "cycle" in data ? data.cycle.name : null;
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

export default function HiringLeadCycleDetails() {
  const dialog = useDialog()
  const { id: cycleId } = useParams()
  const loaderData = useLoaderData<typeof loader>()
  const os = useOsChrome()
  const { cycle, memberSetup } = loaderData
  const isMemberCycle = memberSetup !== null

  const timeline: Timeline = parseTimeline(loaderData.progress?.timeline)
  const rounds = delibRounds(timeline)
  const hasInterviews = timelineHasInterviews(timeline)
  const allMembers = useCurrentMembers(!isMemberCycle || hasInterviews)

  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [showOpenConfirm, setShowOpenConfirm] = useState(false)

  const [searchParams, setSearchParams] = useSearchParams()
  const termStart: Date | null = loaderData.progress?.term ? new Date(loaderData.progress.term.startDate) : null
  const phaseTabs = buildPhaseTabs(
    timeline,
    { hasChallenges: !!cycle.hasChallenges },
    loaderData.progress?.done ?? {},
    termStart,
  )
  const tab = resolvePhaseTab(searchParams.get('tab'), phaseTabs, timeline)
  const activeRound = rounds.find(r => `delib:${r.id}` === tab) ?? null
  const activeInterviewRound = interviewRoundForTab(timeline, tab)
  const viewRoundId = activeInterviewRound?.id ?? FIRST_INTERVIEW_ROUND_ID
  const laterInterviewRoundIds = new Set(
    timelineInterviewRounds(timeline).filter(r => r.index > 0).map(r => r.id),
  )
  const slotFor = (d: { type: string; interviewRoundId?: string | null }): TemplateSlot =>
    releaseSlot(d.type as DecisionSlotType, laterInterviewRoundIds.has(d.interviewRoundId ?? ''))
  const setTab = useCallback((next: string) => {
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev)
      sp.set('tab', next)
      return sp
    }, { replace: true, preventScrollReset: true })
  }, [setSearchParams])

  const live = useLeadCycleData({
    cycleId,
    viewRoundId,
    isMemberCycle,
    hasInterviews,
    initialStatus: cycle.statusUpdates[0]?.newStatus ?? 'Draft',
    revalidateKey: loaderData,
  })
  const { cycleStatus, setCycleStatus, statusUpdating, statusError, setStatusError, advanceStatus, loadInterviews } = live

  const decisions = usePendingDecisions(loaderData.pendingDecisions)
  const decisionCtx: DecisionListContext = {
    cycleId: cycleId ?? '',
    tab,
    confidentialityRequired: loaderData.confidentialityRequired,
    hiringEmails: loaderData.hiringEmails,
    termOptions: loaderData.termOptions,
    termId: cycle.termId ?? null,
    offerRespondBy: cycle.offerRespondBy ?? null,
    waitlistRespondBy: cycle.waitlistRespondBy ?? null,
    activeRoundInterviewRoundId: activeRound?.interviewRoundId,
    slotFor,
  }

  const interviewWindowSet = !!live.config.interviewStartDate && !!live.config.interviewEndDate

  const delibRows = (roundId: string) =>
    cycle.domains.map((d) => {
      const state = loaderData.phaseStatusByDomain?.[d.domainId]?.rounds?.[roundId] ?? 'none'
      return {
        domainId: d.domainId,
        name: d.domain?.name ?? d.domain?.displayName ?? d.domainId,
        done: state === 'closed',
        detail: state === 'closed' ? 'Closed' : state === 'active' ? 'In progress' : 'Not started',
      }
    })

  const draftChecklistMet = cycleStatus !== 'Draft' || (() => {
    const domains = cycle.domains
    const allDomainsReady = domains.length > 0 && domains.every((d) => d.isReady)
    const needsForm = isMemberCycle || !cycle.hasChallenges
    return !!cycle.closeDate && allDomainsReady && (!needsForm || !!cycle.applicationForm)
  })()
  const statusIdx = STATUS_FLOW.findIndex((s) => s === cycleStatus)
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

      {tab === 'setup' && (
        <SetupTab
          data={loaderData}
          cycleStatus={cycleStatus}
          timeline={timeline}
          hasInterviews={hasInterviews}
          hasLaterInterviewRounds={laterInterviewRoundIds.size > 0}
        />
      )}

      {activeInterviewRound && (
        <InterviewsTab data={loaderData} cycleId={cycleId ?? ''} tab={tab} state={live} />
      )}

      {tab === 'review' && (
        <ReviewTab
          data={loaderData}
          members={allMembers}
          reviewers={live.reviewers}
          interviewers={live.interviewers}
          interviewWindowSet={interviewWindowSet}
          viewRoundId={viewRoundId}
          hasInterviews={hasInterviews}
          onAddReviewer={live.addReviewer}
          onRemoveReviewer={live.removeReviewer}
          onAddInterviewer={live.addInterviewer}
          onRemoveInterviewer={live.removeInterviewer}
        />
      )}
      {tab !== 'review' && activeInterviewRound && activeInterviewRound.index > 0 && (
        <InterviewersSection
          cycle={cycle}
          isMemberCycle={isMemberCycle}
          members={allMembers}
          interviewers={live.interviewers}
          interviewWindowSet={interviewWindowSet}
          viewRoundId={viewRoundId}
          onAdd={live.addInterviewer}
          onRemove={live.removeInterviewer}
        />
      )}
      {activeRound && (
        <NavSection id="round-boards" title={activeRound.label}>
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
        <NavSection id="invites" title="Interview invites"><DecisionList kind="invites" decisions={decisions} ctx={decisionCtx} /></NavSection>
      )}
      {activeRound?.isFinal && isMemberCycle && (
        <NavSection id="finalize" title="Draft decisions"><DecisionList kind="finalize" decisions={decisions} ctx={decisionCtx} /></NavSection>
      )}

      {tab === 'decisions' && (
        <DecisionsTab
          cycleStatus={cycleStatus}
          showFinalize={!(activeRound?.isFinal && isMemberCycle)}
          decisions={decisions}
          ctx={decisionCtx}
          onComplete={() => setShowCompleteConfirm(true)}
        />
      )}
      </SectionNavLayout>
    </div>
  )

  const { collabToken, currentUserId, presenceUserName, presencePhotoUrl, presenceSubtitle } = loaderData
  return collabToken ? (
    <PresenceProvider
      pageId={`cycle:${cycleId}`}
      token={collabToken}
      userName={presenceUserName ?? ''}
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
