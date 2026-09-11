import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
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
import { cn } from "~/lib/cn";
import type { ProjectStatusFacts } from "../lib/project-status";
import type { ProjectTldrResponse } from "~/routes/api.ai.project-tldr";

// The compact work-status strip above the project timeline (Progress tab).
// Two layers: a deterministic chip row (progress, active sprint, attention
// flags) computed in the loader, and — when the `project-tldr-ai` flag is on
// and a provider is configured — an AI one-liner cached on the project. The
// whole bar is gated by `project-status-bar` at the call site.

const STATUS_DOT: Record<ProjectStatusFacts["projectStatus"], string> = {
  Active: "bg-emerald-500",
  Paused: "bg-amber-500",
  Archived: "bg-muted-foreground",
};

type ChipTone = "neutral" | "attention" | "good";

function Chip({
  tone = "neutral",
  icon: Icon,
  children,
}: {
  tone?: ChipTone;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "attention" && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        tone === "neutral" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}

function sprintDeadline(daysRemaining: number): string {
  if (daysRemaining < 0) return `${-daysRemaining}d over`;
  if (daysRemaining === 0) return "ends today";
  if (daysRemaining === 1) return "ends tomorrow";
  return `ends in ${daysRemaining}d`;
}

export function ProjectStatusBar({
  facts,
  projectId,
  aiTldr,
  aiTldrStale,
  aiLineEnabled,
}: {
  facts: ProjectStatusFacts;
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

  const attention: { key: string; n: number; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { key: "overdue", n: facts.overdue, label: `${facts.overdue} overdue`, icon: AlertTriangle },
    { key: "unscheduled", n: facts.unscheduled, label: `${facts.unscheduled} unscheduled`, icon: CalendarOff },
    { key: "stale", n: facts.stale, label: `${facts.stale} stale`, icon: Clock },
  ].filter((a) => a.n > 0);

  return (
    <div className={cn(panel, "px-3 py-2.5 flex flex-col gap-2")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[facts.projectStatus])} />
          {facts.projectStatus}
        </span>

        {!facts.hasWork ? (
          <Chip>No active work yet</Chip>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("h-1.5 w-16 overflow-hidden rounded-full", os ? "bg-os-container" : "bg-muted")}>
                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${progressPct}%` }} />
              </span>
              {facts.doneTasks}/{facts.totalTasks} done
            </span>

            {facts.activeSprint ? (
              <Chip
                icon={CalendarClock}
                tone={facts.activeSprint.daysRemaining < 0 ? "attention" : "neutral"}
              >
                {facts.activeSprint.name} · {sprintDeadline(facts.activeSprint.daysRemaining)}
              </Chip>
            ) : null}

            {attention.map((a) => (
              <Chip key={a.key} tone="attention" icon={a.icon}>
                {a.label}
              </Chip>
            ))}

            {facts.inReview > 0 ? (
              <Chip icon={Eye}>{facts.inReview} in review</Chip>
            ) : null}

            {attention.length === 0 ? <Chip tone="good">On track</Chip> : null}
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
