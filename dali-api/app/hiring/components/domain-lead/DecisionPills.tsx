import { cn } from "~/lib/cn";
import { type DecisionPill, type PrePipelinePill } from "~/hiring/lib/decision-pills";
import { DECISION_LABELS, DECISION_TONES } from "~/hiring/lib/labels";
import { Tooltip } from "~/components/ui/floating";
import { Pill } from "~/components/ui/Pill";

// Stage treatment composes on top of the `border border-current/40` the badge
// always applies. Draft reads as "tentative" (faded + dashed, same hue);
// Final/Released keep the solid same-hue border.
export const STAGE_TREATMENT: Record<DecisionPill["stage"], string> = {
  Draft: "opacity-60",
  Final: "",
  Released: "",
};

export const DECISION_TOOLTIPS: Record<DecisionPill["stage"], (typeLabel: string) => string> = {
  Draft: (t) => `Draft ${t} — not yet finalized. Click Finalize to lock in.`,
  Final: (t) => `Final ${t} — decision locked. Will be released to the applicant by the hiring lead.`,
  Released: (t) => `Released ${t} — applicant has been notified.`,
};

export function DecisionPillBadge({ pill, isCurrent = false }: { pill: DecisionPill; isCurrent?: boolean }) {
  const baseLabel = DECISION_LABELS[pill.type] ?? pill.type;
  const rankSuffix =
    pill.type === "Waitlisted" && pill.waitlistRank != null
      ? ` #${pill.waitlistRank}`
      : "";
  const stageSuffix = ` (${pill.stage.toLowerCase()})`;
  const tooltip = DECISION_TOOLTIPS[pill.stage](`${baseLabel}${rankSuffix}`);
  // "Current" emphasis ring uses the pill's OWN hue (ring-current = its text
  // color) so it reads as the same color as the border, not a competing gray
  // ring sitting just outside a red/green/etc. border.
  const accent = isCurrent ? "ring-2 ring-offset-1 ring-current/60" : "";
  return (
    <Tooltip content={tooltip} variant="rich">
      <span aria-label={tooltip} className={cn("inline-flex rounded-full", STAGE_TREATMENT[pill.stage], accent)}>
        <Pill dot={DECISION_TONES[pill.type] ?? "neutral"}>
          {baseLabel}{rankSuffix}{stageSuffix}
        </Pill>
      </span>
    </Tooltip>
  );
}

export const PRE_PIPELINE_LABELS: Record<PrePipelinePill, string> = {
  Reviewing: "Reviewing",
  InterviewScheduled: "Interview scheduled",
  PostInterview: "Post-interview",
};

export const PRE_PIPELINE_TOOLTIPS: Record<PrePipelinePill, string> = {
  Reviewing: "Reviewers are evaluating this application. No decision has been made yet.",
  InterviewScheduled: "Applicant has booked an interview. Decision is pending until after the interview.",
  PostInterview: "Interview is complete. Waiting on final delibs to decide.",
};

export function PrePipelinePillBadge({ pill }: { pill: PrePipelinePill }) {
  return (
    <Tooltip content={PRE_PIPELINE_TOOLTIPS[pill]} variant="rich">
      <span aria-label={PRE_PIPELINE_TOOLTIPS[pill]} className="inline-flex">
        <Pill dot="neutral">{PRE_PIPELINE_LABELS[pill]}</Pill>
      </span>
    </Tooltip>
  );
}
