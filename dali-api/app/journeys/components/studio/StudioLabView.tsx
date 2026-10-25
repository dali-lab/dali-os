import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Clock, FileText, ListChecks, Presentation, RotateCcw, Send } from "lucide-react";
import { DocEditor } from "~/components/doc";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { Pill, type PillTone } from "~/hiring/components/cycle-setup/SetupCard";
import { cn } from "~/lib/cn";
import { LESSON_FEATURES } from "~/journeys/lib/doc-features";
import { evaluateCriteria, KIND_LABELS, needsMentor, readyForReview } from "~/journeys/lib/studio";
import type { StudioLab, StudioWork, SubmissionStatus } from "~/journeys/lib/studio-types";
import type { RichDoc } from "~/journeys/lib/types";
import { CanvasBoard } from "./canvas/CanvasBoard";
import { StudioChecklist } from "./StudioChecklist";

export interface StudioLabViewProps {
  studio: StudioLab;
  title: string;
  subtitle?: string;
  work: StudioWork;
  onWorkChange: (fn: (w: StudioWork) => StudioWork) => void;
  selfChecks: Record<string, boolean>;
  onToggleSelf: (criterionId: string) => void;
  status: SubmissionStatus;
  mentorChecks: Record<string, boolean>;
  mentorNote?: string | null;
  reviewerName?: string | null;
  isCompleted: boolean;
  onSubmit: () => void;
  onComplete: () => void;
  completeLabel?: string;
  onReset: () => void;
  onExit: () => void;
  exitLabel: string;
  /** Bumped on reset so the document editor reloads its content. */
  workKey?: number;
  /** Disables submit and reset while a save or submit is in flight. */
  busy?: boolean;
  /** Extra header action, e.g. simulating a mentor in previews. */
  extraAction?: ReactNode;
}

const STATUS_PILLS: Partial<Record<SubmissionStatus, { label: string; dot: PillTone }>> = {
  submitted: { label: "Waiting for review", dot: "warning" },
  approved: { label: "Approved", dot: "success" },
  "changes-requested": { label: "Changes requested", dot: "danger" },
};

/** Work is read-only while a mentor reviews it and once it's approved. */
export function isWorkLocked(status: SubmissionStatus): boolean {
  return status === "submitted" || status === "approved";
}

type Panel = "brief" | "checks";

export function StudioLabView({
  studio,
  title,
  subtitle,
  work,
  onWorkChange,
  selfChecks,
  onToggleSelf,
  status,
  mentorChecks,
  mentorNote,
  reviewerName,
  isCompleted,
  onSubmit,
  onComplete,
  completeLabel = "Complete module",
  onReset,
  onExit,
  exitLabel,
  workKey = 0,
  busy = false,
  extraAction,
}: StudioLabViewProps) {
  const dialog = useDialog();
  const [panel, setPanel] = useState<Panel>("brief");
  const results = useMemo(
    () => evaluateCriteria(studio, work, selfChecks, mentorChecks, status),
    [studio, work, selfChecks, mentorChecks, status],
  );
  const hasMentor = needsMentor(studio);
  const ready = readyForReview(results);
  const locked = isWorkLocked(status);
  const passed = results.filter((r) => r.state === "pass").length;
  const pill = STATUS_PILLS[status];
  const KindIcon = studio.kind === "canvas" ? Presentation : FileText;

  const handleReset = async () => {
    const ok = await dialog.confirm({
      title: "Start this lab over?",
      description: "Your work and ticks go back to the starting point.",
      confirmLabel: "Start over",
      tone: "destructive",
    });
    if (ok) onReset();
  };

  let action: ReactNode;
  if (isCompleted) {
    action = (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-os-green/15 px-3 text-sm font-medium text-os-green">
        <Check className="h-3.5 w-3.5" aria-hidden />
        Completed
      </span>
    );
  } else if (!hasMentor || status === "approved") {
    action = (
      <button
        type="button"
        disabled={!ready || busy}
        onClick={onComplete}
        title={ready ? undefined : "Finish the checklist first"}
        className={buttonClasses("primary", "sm")}
      >
        {completeLabel}
      </button>
    );
  } else if (status === "submitted") {
    action = (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-os-container px-3 text-sm text-os-grey">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        Submitted
      </span>
    );
  } else {
    action = (
      <button
        type="button"
        disabled={!ready || busy}
        onClick={onSubmit}
        title={ready ? undefined : "Finish the automatic checks and self-checks first"}
        className={buttonClasses("primary", "sm")}
      >
        <Send className="h-3.5 w-3.5" aria-hidden />
        {status === "changes-requested" ? "Resubmit for review" : "Submit for review"}
      </button>
    );
  }

  const paragraphs = studio.brief.split(/\n\s*\n/).filter((p) => p.trim());
  const showFeedback = status === "changes-requested" || (status === "approved" && mentorNote);

  return (
    <div className="flex h-full flex-col bg-os-bg text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-os-container px-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onExit} className={buttonClasses("ghost", "sm")}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {exitLabel}
          </button>
          <span className="h-5 w-px bg-os-container" aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {subtitle && <p className="truncate text-xs text-os-muted">{subtitle}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {pill && (
            <span className="hidden sm:inline-flex">
              <Pill dot={pill.dot}>{pill.label}</Pill>
            </span>
          )}
          <span className="hidden text-xs tabular-nums text-os-grey md:inline" aria-live="polite">
            {passed}/{results.length} done
          </span>
          {extraAction}
          {!locked && !isCompleted && (
            <button type="button" onClick={handleReset} disabled={busy} className={buttonClasses("ghost", "sm")}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reset
            </button>
          )}
          {action}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          aria-label="Lab guide"
          className="flex max-h-[45vh] shrink-0 flex-col border-b border-os-container lg:max-h-none lg:w-[360px] lg:border-b-0 lg:border-r"
        >
          <div className="shrink-0 px-4 pt-3">
            <SegmentedTabButtons
              size="sm"
              label="Guide sections"
              items={[
                { label: "Brief", icon: KindIcon, active: panel === "brief", onClick: () => setPanel("brief") },
                { label: `Checklist ${passed}/${results.length}`, icon: ListChecks, active: panel === "checks", onClick: () => setPanel("checks") },
              ]}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-5">
            {showFeedback && (
              <div className={cn("mb-6 rounded-os-item p-4 text-sm", status === "approved" ? "bg-os-green/10" : "bg-destructive/10")}>
                <p className={cn("font-medium", status === "approved" ? "text-os-green" : "text-destructive")}>
                  {status === "approved" ? "Approved" : "Changes requested"}
                  {reviewerName && <span className="font-normal text-os-grey"> · {reviewerName}</span>}
                </p>
                {mentorNote && <p className="mt-1.5 whitespace-pre-line leading-6 text-foreground/85">{mentorNote}</p>}
              </div>
            )}
            {panel === "brief" ? (
              <div>
                <p className="text-xs text-os-muted">{KIND_LABELS[studio.kind]} lab</p>
                <h2 className="mt-1 font-heading text-lg font-semibold">{studio.title}</h2>
                <div className="mt-3 space-y-3 text-sm leading-6 text-foreground/85">
                  {paragraphs.map((p, i) => (
                    <p key={i} className="whitespace-pre-line">
                      {p}
                    </p>
                  ))}
                </div>
                <button type="button" onClick={() => setPanel("checks")} className={buttonClasses("secondary", "sm", "mt-6")}>
                  <ListChecks className="h-3.5 w-3.5" aria-hidden />
                  See what's checked
                </button>
              </div>
            ) : (
              <StudioChecklist results={results} canTick={!locked && !isCompleted} onToggleSelf={onToggleSelf} />
            )}
            {status === "submitted" && (
              <p className="mt-6 text-xs leading-5 text-os-muted">Your work is locked while a mentor reviews it. Their feedback shows up here.</p>
            )}
          </div>
        </aside>

        <main className="relative min-h-[420px] min-w-0 flex-1">
          {studio.kind === "canvas" ? (
            <CanvasBoard
              mode="learner"
              readOnly={locked || isCompleted}
              items={work.items ?? []}
              onItemsChange={(fn) => onWorkChange((w) => ({ ...w, items: fn(w.items ?? []) }))}
            />
          ) : (
            <div className="absolute inset-0 overflow-y-auto">
              <div className="max-w-3xl px-6 pb-24 pt-6 lg:px-12">
                <DocEditor
                  key={`${workKey}:${locked ? "locked" : "open"}`}
                  editable={!locked && !isCompleted}
                  features={LESSON_FEATURES}
                  placeholder="Start writing"
                  initialContent={work.doc ?? []}
                  onChange={(blocks) => {
                    if (!locked && !isCompleted) onWorkChange((w) => ({ ...w, doc: blocks as RichDoc }));
                  }}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
