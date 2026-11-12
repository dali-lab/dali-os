import { useState } from "react";
import { Eye } from "lucide-react";
import { cn } from "~/lib/cn";
import { Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { useToast } from "~/components/ui/toast";
import { useDialog } from "~/components/ui/dialog";
import { Pill } from "~/components/ui/Pill";
import { SetupCard } from "~/hiring/components/cycle-setup/SetupCard";
import { NavSection } from "~/hiring/components/cycle-setup/SectionNav";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { FilterSelect } from "~/hiring/components/lead-cycle/InterviewCoverage";
import { DecisionEmailPreviewModal } from "~/hiring/components/lead-cycle/LeadCycleModals";
import { joinNames, acceptPreemptionWarning } from "~/hiring/components/lead-cycle/DomainOverridePanel";
import { FIRST_INTERVIEW_ROUND_ID } from "~/hiring/lib/cycle-timeline";
import type { TemplateSlot } from "~/hiring/lib/email-variables";
import { type DecisionSlice, DECISION_SLICES } from "~/hiring/lib/decision-slices";
import type { PendingDecision } from "~/hiring/lib/lead-cycle-types";
import type { LeadCycleData } from "~/hiring/lib/lead-cycle.server";

export function usePendingDecisions(initial: PendingDecision[]) {
  const toast = useToast();
  const dialog = useDialog();
  const [pendingDecisions, setPendingDecisions] = useState<PendingDecision[]>(initial);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [releasingAll, setReleasingAll] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [previewDecisionId, setPreviewDecisionId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  async function confirmReleaseOne(d: PendingDecision) {
    if (releasing === d.id) return;
    const warning = acceptPreemptionWarning(d);
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
      return;
    setReleasing(d.id);
    await fetch(`/api/hiring/decisions/${d.id}/release`, { method: "POST", credentials: "include" });
    setPendingDecisions((prev) => prev.filter((p) => p.id !== d.id));
    setReleasing(null);
  }

  async function finalizeDecisions(ids: string[]) {
    if (finalizing || ids.length === 0) return;
    setFinalizing(true);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/hiring/decisions/${id}/finalize`, { method: "POST", credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error ?? `Couldn't finalize (HTTP ${res.status}).`);
          return;
        }
        const newFinal = await res.json();
        setPendingDecisions((prev) => prev.map((p) => (p.id === id ? { ...p, id: newFinal.id, stage: "Final" } : p)));
      }
    } finally {
      setFinalizing(false);
    }
  }

  return {
    pendingDecisions,
    setPendingDecisions,
    releasing,
    releasingAll,
    setReleasingAll,
    finalizing,
    previewDecisionId,
    setPreviewDecisionId,
    domainFilter,
    setDomainFilter,
    typeFilter,
    setTypeFilter,
    confirmReleaseOne,
    finalizeDecisions,
  };
}

export type PendingDecisionsState = ReturnType<typeof usePendingDecisions>;

export type DecisionListContext = {
  cycleId: string;
  tab: string;
  confidentialityRequired: LeadCycleData["confidentialityRequired"];
  hiringEmails: Record<string, { subject: string; body: string }>;
  termOptions: { id: string; code: string }[];
  termId: string | null;
  offerRespondBy: Date | string | null;
  waitlistRespondBy: Date | string | null;
  activeRoundInterviewRoundId: string | null | undefined;
  slotFor: (d: { type: string; interviewRoundId?: string | null }) => TemplateSlot;
};

export function DecisionList({ kind, decisions, ctx }: { kind: DecisionSlice; decisions: PendingDecisionsState; ctx: DecisionListContext }) {
  const os = useOsChrome();
  const dialog = useDialog();
  const {
    pendingDecisions, setPendingDecisions, releasing, releasingAll, setReleasingAll, finalizing,
    previewDecisionId, setPreviewDecisionId, domainFilter, setDomainFilter, typeFilter, setTypeFilter,
    confirmReleaseOne, finalizeDecisions,
  } = decisions;

  if (ctx.confidentialityRequired) {
    return (
      <ConfidentialityGate
        cycleId={ctx.cycleId}
        reason={ctx.confidentialityRequired}
        next={`/hiring/lead/cycle/${ctx.cycleId}?tab=${ctx.tab}`}
      />
    );
  }
  const { slotFor } = ctx;
  const scoped = pendingDecisions.filter(
    (d) =>
      DECISION_SLICES[kind].include(d) &&
      (kind !== "invites" || (d.interviewRoundId ?? FIRST_INTERVIEW_ROUND_ID) === ctx.activeRoundInterviewRoundId),
  );
  const isBound = (d: PendingDecision) => !!ctx.hiringEmails[slotFor(d)];
  const domainNameOf = (d: PendingDecision) => d.domainApplication.domain?.name ?? "";
  const availableDomains = Array.from(new Set(scoped.map(domainNameOf))).sort();
  const availableTypes = Array.from(new Set(scoped.map((d) => d.type as string))).sort();
  const filtersActive = domainFilter !== "all" || typeFilter !== "all";
  const filteredDecisions = scoped.filter((d) => {
    if (domainFilter !== "all" && domainNameOf(d) !== domainFilter) return false;
    if (typeFilter !== "all" && d.type !== typeFilter) return false;
    return true;
  });
  const drafts = filteredDecisions.filter((d) => d.stage === "Draft");
  const finals = filteredDecisions.filter((d) => d.stage === "Final");
  const releasable = finals.filter(isBound);
  const skipped = finals.length - releasable.length;
  const releaseAll = async () => {
    if (releasingAll) return;
    const ids = releasable.map((d) => d.id);
    if (ids.length === 0) return;
    const preemptions = releasable.filter((d) => acceptPreemptionWarning(d) !== null);
    const preemptionNote =
      preemptions.length > 0
        ? ` ${preemptions.length} of these acceptance${preemptions.length === 1 ? "" : "s"} will also close a still-open sibling application: ${joinNames(
            preemptions.map(
              (d) =>
                `${d.domainApplication.application.user.firstName} (${joinNames((d.openSiblingDomains ?? []).map((s) => s.name))})`,
            ),
          )}.`
        : "";
    if (
      !(await dialog.confirm({
        title: `Release ${ids.length} decision${ids.length === 1 ? "" : "s"}?`,
        description: `This emails ${ids.length === 1 ? "this applicant" : `all ${ids.length} applicants`} their decision right now. It can't be undone.${preemptionNote}`,
        confirmLabel: `Release ${ids.length}`,
        tone: "destructive",
      }))
    )
      return;
    setReleasingAll(true);
    for (const id of ids) {
      await fetch(`/api/hiring/decisions/${id}/release`, { method: "POST", credentials: "include" });
    }
    const releasedIds = new Set(ids);
    setPendingDecisions((prev) => prev.filter((p) => !releasedIds.has(p.id)));
    setReleasingAll(false);
  };
  const rowActions = (d: PendingDecision) => {
    if (d.stage === "Draft") {
      return (
        <button type="button" onClick={() => finalizeDecisions([d.id])} disabled={finalizing} className={buttonClasses("secondary", "sm")}>
          Finalize
        </button>
      );
    }
    const hasBinding = isBound(d);
    return (
      <>
        <Tooltip content="Preview email">
          <button type="button" onClick={() => setPreviewDecisionId(d.id)} className="os-icon-btn" aria-label="Preview email">
            <Eye className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content={!hasBinding ? `Write this decision's email on Setup first.` : null} variant="rich">
          <span>
            <button
              type="button"
              onClick={() => confirmReleaseOne(d)}
              disabled={releasing === d.id || releasingAll || !hasBinding}
              className={buttonClasses("primary", "sm")}
            >
              {releasing === d.id ? "Releasing…" : "Release"}
            </button>
          </span>
        </Tooltip>
      </>
    );
  };
  const typeTone = (type: string) =>
    type === "Accepted" ? "success" : type === "Waitlisted" ? "warning" : type === "Rejected" ? "neutral" : "accent";
  const showDomainFilter = availableDomains.length > 1;
  const showTypeFilter = availableTypes.length > 1;
  const previewed = previewDecisionId ? scoped.find((x) => x.id === previewDecisionId) : undefined;
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
                onClick={() => finalizeDecisions(drafts.map((d) => d.id))}
                disabled={finalizing}
                className={buttonClasses("secondary", "md")}
              >
                {finalizing ? "Finalizing…" : `Finalize all (${drafts.length})`}
              </button>
            )}
            {finals.length > 0 && (
              <Tooltip content={skipped > 0 ? `${skipped} skipped, no email written` : null}>
                <span>
                  <button
                    type="button"
                    onClick={releaseAll}
                    disabled={releasable.length === 0 || releasingAll}
                    className={buttonClasses("primary", "md")}
                  >
                    {releasingAll ? "Releasing…" : `Release ${filtersActive ? "shown" : "all"} (${releasable.length})`}
                  </button>
                </span>
              </Tooltip>
            )}
          </>
        }
      >
        {(showDomainFilter || showTypeFilter) && (
          <div className="flex flex-wrap items-center gap-2">
            {showDomainFilter && (
              <FilterSelect label="Domain" value={domainFilter} onChange={setDomainFilter} allLabel="All domains" values={availableDomains} />
            )}
            {showTypeFilter && (
              <FilterSelect label="Decision" value={typeFilter} onChange={setTypeFilter} allLabel="All decisions" values={availableTypes} />
            )}
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setDomainFilter("all");
                  setTypeFilter("all");
                }}
                className={buttonClasses("ghost", "sm")}
              >
                Clear
              </button>
            )}
          </div>
        )}
        {scoped.length > 0 && (
          <div className="flex flex-col gap-2">
            {filteredDecisions.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {d.domainApplication.application.user.firstName} {d.domainApplication.application.user.lastName}
                  </span>
                  <span className="text-sm text-os-grey">
                    {[domainNameOf(d), `by ${d.madeBy.firstName} ${d.madeBy.lastName}`].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {kind !== "invites" && <Pill dot={typeTone(d.type)}>{d.type}</Pill>}
                  {d.stage === "Draft" && <Pill>Draft</Pill>}
                  {rowActions(d)}
                </div>
              </div>
            ))}
            {filteredDecisions.length === 0 && <p className={cn(os.bodyText, "py-3 text-center")}>No decisions match these filters.</p>}
          </div>
        )}
      </SetupCard>
      {previewed && (
        <DecisionEmailPreviewModal
          decision={previewed}
          email={ctx.hiringEmails[slotFor(previewed)] ?? null}
          slot={slotFor(previewed)}
          dates={{
            startTermCode:
              previewed.domainApplication.application.startTerm?.code ??
              ctx.termOptions.find((t) => t.id === ctx.termId)?.code ??
              null,
            offerRespondBy: ctx.offerRespondBy ? new Date(ctx.offerRespondBy) : null,
            waitlistRespondBy: ctx.waitlistRespondBy ? new Date(ctx.waitlistRespondBy) : null,
          }}
          onClose={() => setPreviewDecisionId(null)}
        />
      )}
    </>
  );
}

export function DecisionsTab({
  cycleStatus,
  showFinalize,
  decisions,
  ctx,
  onComplete,
}: {
  cycleStatus: string;
  showFinalize: boolean;
  decisions: PendingDecisionsState;
  ctx: DecisionListContext;
  onComplete: () => void;
}) {
  const os = useOsChrome();
  return (
    <>
      {showFinalize && (
        <NavSection id="finalize" title="Draft decisions">
          <DecisionList kind="finalize" decisions={decisions} ctx={ctx} />
        </NavSection>
      )}
      <NavSection id="release" title="Decisions to release">
        <DecisionList kind="outcomes" decisions={decisions} ctx={ctx} />
      </NavSection>
      {cycleStatus === "UnderReview" && (
        <NavSection id="complete" title="Complete the cycle">
          <section className={`${os.panel} ${os.panelPad} flex flex-wrap items-center justify-between gap-3`}>
            <div className="flex flex-col gap-1">
              <h3 className={os.sectionTitle}>Complete the cycle</h3>
              <p className={os.bodyText}>Once every decision is out, mark the cycle complete.</p>
            </div>
            <button type="button" onClick={onComplete} className={buttonClasses("primary", "md")}>
              Complete cycle
            </button>
          </section>
        </NavSection>
      )}
    </>
  );
}
