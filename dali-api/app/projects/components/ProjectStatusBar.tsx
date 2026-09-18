import {
  forwardRef,
  useEffect,
  useRef,
  type ComponentType,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useFetcher } from "react-router";
import {
  AlertTriangle,
  CalendarClock,
  CalendarOff,
  Clock,
  Eye,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import {
  STALE_DAYS,
  type ActiveSprintFacts,
  type ProjectStatusFacts,
  type StatusBreakdown,
} from "../lib/project-status";
import type { ProjectTldrResponse } from "~/routes/api.ai.project-tldr";

// The compact work-status strip above the project timeline (Progress tab).
// Two layers: a deterministic chip row (progress, active sprint, attention
// flags) computed in the loader, and — when the `project-tldr-ai` flag is on
// and a provider is configured — an AI one-liner cached on the project. The
// whole bar is gated by `project-status-bar` at the call site.
//
// Every chip explains *why* on hover: the counts alone read as bare numbers, so
// each one opens a rich tooltip naming the tasks behind it (which are overdue,
// what's left to do, the sprint window). Detail comes pre-computed from the
// loader as `breakdown`.

const STATUS_DOT: Record<ProjectStatusFacts["projectStatus"], string> = {
  Active: "bg-emerald-500",
  Paused: "bg-amber-500",
  Archived: "bg-muted-foreground",
};

const STATUS_TIP: Record<ProjectStatusFacts["projectStatus"], string> = {
  Active: "This project is actively running.",
  Paused: "Work on this project is paused.",
  Archived: "This project is archived — no longer active.",
};

const DAY_MS = 24 * 60 * 60 * 1000;

type ChipTone = "neutral" | "attention" | "good";

const Chip = forwardRef<
  HTMLSpanElement,
  {
    tone?: ChipTone;
    icon?: ComponentType<{ className?: string }>;
    children: ReactNode;
  } & HTMLAttributes<HTMLSpanElement>
>(function Chip({ tone = "neutral", icon: Icon, children, className, ...rest }, ref) {
  return (
    <span
      ref={ref}
      {...rest}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "attention" && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        tone === "neutral" && "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {children}
    </span>
  );
});

function sprintDeadline(daysRemaining: number): string {
  if (daysRemaining < 0) return `${-daysRemaining}d over`;
  if (daysRemaining === 0) return "ends today";
  if (daysRemaining === 1) return "ends tomorrow";
  return `ends in ${daysRemaining}d`;
}

// Sprint boundaries are UTC-midnight day markers — format in UTC so the window
// doesn't slip a day in western timezones. endsAt is the exclusive boundary
// (start of the day after the sprint), so the inclusive last day is one back.
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function sprintWindow(s: ActiveSprintFacts): string {
  const lastDay = new Date(new Date(s.endsAt).getTime() - DAY_MS).toISOString();
  return `${fmtDay(s.startsAt)} – ${fmtDay(lastDay)}`;
}

const isNotable = (p: string) => p === "High" || p === "Urgent";

// ── Tooltip content pieces ────────────────────────────────────────────────────

function TipHeading({ children }: { children: ReactNode }) {
  return <p className="font-semibold text-foreground">{children}</p>;
}

// A "why" tooltip: a heading, an optional one-line definition, then the named
// tasks behind the count, collapsing the overflow to "+N more".
function TipTaskList({
  heading,
  note,
  items,
  moreCount,
}: {
  heading: string;
  note?: string;
  items: ReactNode[];
  moreCount: number;
}) {
  return (
    <div className="space-y-1">
      <TipHeading>{heading}</TipHeading>
      {note ? <p className="text-muted-foreground">{note}</p> : null}
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-muted-foreground">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
            <span className="min-w-0">{it}</span>
          </li>
        ))}
      </ul>
      {moreCount > 0 ? <p className="text-muted-foreground/70">+{moreCount} more</p> : null}
    </div>
  );
}

// Shared trigger affordance: signal the chip is hoverable for detail.
const TRIGGER_HINT = "cursor-help";

export function ProjectStatusBar({
  facts,
  breakdown,
  projectId,
  aiTldr,
  aiTldrStale,
  aiLineEnabled,
}: {
  facts: ProjectStatusFacts;
  breakdown: StatusBreakdown;
  projectId: string;
  aiTldr: string | null;
  aiTldrStale: boolean;
  aiLineEnabled: boolean;
}) {
  const { os, panel } = useOsChrome();
  const fetcher = useFetcher<ProjectTldrResponse | { error: string } | { aiEnabled: false }>();

  const submit = (force: boolean) =>
    fetcher.submit(
      { projectId, force },
      { method: "post", action: "/api/ai/project-tldr", encType: "application/json" },
    );

  // Auto-generate on first view when the cache is missing or the work has moved
  // on (stale fingerprint). Runs once per mount; the Refresh button re-runs it.
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (!aiLineEnabled || !facts.hasWork || didAutoRun.current) return;
    if (!aiTldr || aiTldrStale) {
      didAutoRun.current = true;
      submit(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiLineEnabled, facts.hasWork, aiTldr, aiTldrStale, projectId]);

  const data = fetcher.data;
  const fetchedTldr = data && "tldr" in data ? data.tldr : undefined;
  const tldrText = fetchedTldr !== undefined ? fetchedTldr : aiTldr;
  const aiLoading = fetcher.state !== "idle";

  const progressPct =
    facts.totalTasks > 0 ? Math.round((facts.doneTasks / facts.totalTasks) * 100) : 0;

  // Each attention flag carries the rich tooltip that explains it — the named
  // tasks (from `breakdown`) plus how many more the list didn't show.
  const attention: {
    key: string;
    n: number;
    label: string;
    icon: ComponentType<{ className?: string }>;
    tip: ReactNode;
  }[] = [
    {
      key: "overdue",
      n: facts.overdue,
      label: `${facts.overdue} overdue`,
      icon: AlertTriangle,
      tip: (
        <TipTaskList
          heading="Overdue"
          items={breakdown.overdue.map((o) => (
            <>
              <span className="text-foreground">{o.title}</span>
              <span> — {o.daysOver <= 0 ? "due today" : `${o.daysOver}d over`}</span>
              {isNotable(o.priority) ? <span> · {o.priority}</span> : null}
            </>
          ))}
          moreCount={facts.overdue - breakdown.overdue.length}
        />
      ),
    },
    {
      key: "unscheduled",
      n: facts.unscheduled,
      label: `${facts.unscheduled} unscheduled`,
      icon: CalendarOff,
      tip: (
        <TipTaskList
          heading="Unscheduled"
          note="In motion but undated — they won't land in a sprint."
          items={breakdown.unscheduled.map((u) => (
            <>
              <span className="text-foreground">{u.title}</span>
              {isNotable(u.priority) ? <span> · {u.priority}</span> : null}
            </>
          ))}
          moreCount={facts.unscheduled - breakdown.unscheduled.length}
        />
      ),
    },
    {
      key: "stale",
      n: facts.stale,
      label: `${facts.stale} stale`,
      icon: Clock,
      tip: (
        <TipTaskList
          heading="Stalled"
          note={`In progress but untouched for ${STALE_DAYS}+ days.`}
          items={breakdown.stale.map((s) => (
            <>
              <span className="text-foreground">{s.title}</span>
              <span> — {s.daysStale}d untouched</span>
            </>
          ))}
          moreCount={facts.stale - breakdown.stale.length}
        />
      ),
    },
  ].filter((a) => a.n > 0);

  return (
    <div className={cn(panel, "px-3 py-2.5 flex flex-col gap-2")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Tooltip variant="rich" placement="bottom" content={STATUS_TIP[facts.projectStatus]}>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground",
              TRIGGER_HINT,
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[facts.projectStatus])} />
            {facts.projectStatus}
          </span>
        </Tooltip>

        {!facts.hasWork ? (
          <Tooltip
            variant="rich"
            placement="bottom"
            content="No tasks on the board yet — add work to track progress here."
          >
            <Chip className={TRIGGER_HINT}>No active work yet</Chip>
          </Tooltip>
        ) : (
          <>
            <Tooltip
              variant="rich"
              placement="bottom"
              content={
                <div className="space-y-1">
                  <TipHeading>
                    {facts.doneTasks} of {facts.totalTasks} done · {progressPct}%
                  </TipHeading>
                  <ul className="space-y-0.5">
                    {breakdown.byStatus.map((s) => (
                      <li
                        key={s.status}
                        className="flex items-center justify-between gap-6 text-muted-foreground"
                      >
                        <span>{s.label}</span>
                        <span className="tabular-nums text-foreground">{s.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              }
            >
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-[11px] text-muted-foreground",
                  TRIGGER_HINT,
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-16 overflow-hidden rounded-full",
                    os ? "bg-os-container" : "bg-muted",
                  )}
                >
                  <span
                    className="block h-full rounded-full bg-emerald-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </span>
                {facts.doneTasks}/{facts.totalTasks} done
              </span>
            </Tooltip>

            {facts.activeSprint ? (
              <Tooltip
                variant="rich"
                placement="bottom"
                content={
                  <div className="space-y-0.5">
                    <TipHeading>{facts.activeSprint.label}</TipHeading>
                    <p className="text-muted-foreground">{sprintWindow(facts.activeSprint)}</p>
                    <p className="text-muted-foreground">
                      Sprint {sprintDeadline(facts.activeSprint.daysRemaining)}
                    </p>
                  </div>
                }
              >
                <Chip
                  icon={CalendarClock}
                  tone={facts.activeSprint.daysRemaining < 0 ? "attention" : "neutral"}
                  className={TRIGGER_HINT}
                >
                  {facts.activeSprint.label} · {sprintDeadline(facts.activeSprint.daysRemaining)}
                </Chip>
              </Tooltip>
            ) : null}

            {attention.map((a) => (
              <Tooltip key={a.key} variant="rich" placement="bottom" content={a.tip}>
                <Chip tone="attention" icon={a.icon} className={TRIGGER_HINT}>
                  {a.label}
                </Chip>
              </Tooltip>
            ))}

            {facts.inReview > 0 ? (
              <Tooltip
                variant="rich"
                placement="bottom"
                content={
                  <TipTaskList
                    heading="In review"
                    note="Waiting on a reviewer to sign off."
                    items={breakdown.inReview.map((t) => (
                      <span className="text-foreground">{t}</span>
                    ))}
                    moreCount={facts.inReview - breakdown.inReview.length}
                  />
                }
              >
                <Chip icon={Eye} className={TRIGGER_HINT}>
                  {facts.inReview} in review
                </Chip>
              </Tooltip>
            ) : null}

            {attention.length === 0 ? (
              <Tooltip
                variant="rich"
                placement="bottom"
                content="No overdue, unscheduled, or stalled work — the board is moving."
              >
                <Chip tone="good" className={TRIGGER_HINT}>
                  On track
                </Chip>
              </Tooltip>
            ) : null}
          </>
        )}
      </div>

      {aiLineEnabled && facts.hasWork ? (
        <div className={cn("flex items-start gap-2 border-t pt-2", os ? "border-os-container" : "border-border")}>
          <Sparkles className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", os ? "text-os-accent" : "text-accent-coral")} />
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground">
            {aiLoading && !tldrText ? (
              <span className="animate-pulse">Summarizing project status…</span>
            ) : tldrText ? (
              tldrText
            ) : (
              <span className="text-muted-foreground/70">No summary yet.</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={aiLoading}
            title="Refresh summary"
            aria-label="Refresh summary"
            className={cn(
              "shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
              os ? "hover:bg-os-container" : "hover:bg-muted",
            )}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", aiLoading && "animate-spin")} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
