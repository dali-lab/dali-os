import { useMemo } from "react";

export type EpicStatus = "Open" | "InProgress" | "Done" | "Cancelled";

export type TimelineEpic = {
  id: string;
  title: string;
  status: EpicStatus;
  // Span derived from the epic's sprints (min startsAt → max endsAt). Null
  // when the epic has no scheduled sprints yet — rendered as "unscheduled".
  startsAt: string | null;
  endsAt: string | null;
  sprintCount: number;
};

const STATUS_BAR: Record<EpicStatus, string> = {
  Open: "bg-muted-foreground/40",
  InProgress: "bg-accent-teal/70",
  Done: "bg-accent-teal/40",
  Cancelled: "bg-destructive/40",
};

const STATUS_LABEL: Record<EpicStatus, string> = {
  Open: "Open",
  InProgress: "In progress",
  Done: "Done",
  Cancelled: "Cancelled",
};

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function EpicsTimeline({ epics }: { epics: TimelineEpic[] }) {
  const scheduled = useMemo(
    () => epics.filter((e) => e.startsAt && e.endsAt),
    [epics],
  );

  // Global window across every scheduled epic → each bar's left/width is a
  // percentage of that window. Null when no epic has dates yet (we still
  // render a row per epic, just without an axis).
  const bounds = useMemo(() => {
    if (scheduled.length === 0) return null;
    const starts = scheduled.map((e) => new Date(e.startsAt!).getTime());
    const ends = scheduled.map((e) => new Date(e.endsAt!).getTime());
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    // Guard a zero-width window (single same-day epic) so we don't divide by 0.
    const span = max - min || 1;
    return { min, max, span };
  }, [scheduled]);

  if (epics.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-8 text-center border border-border rounded-lg bg-card">
        No epics yet.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card p-4">
      {bounds && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3 ml-40 pl-3">
          <span>{fmt(new Date(bounds.min))}</span>
          <span>{fmt(new Date(bounds.max))}</span>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {epics.map((epic) => {
          const hasDates = !!(epic.startsAt && epic.endsAt && bounds);
          return (
            <div key={epic.id} className="flex items-center gap-3">
              <div
                className="w-40 flex-shrink-0 text-sm text-foreground truncate"
                title={epic.title}
              >
                {epic.title}
              </div>
              <div className="relative flex-1 h-7 bg-muted/20 rounded">
                {hasDates ? (
                  (() => {
                    const start = new Date(epic.startsAt!).getTime();
                    const end = new Date(epic.endsAt!).getTime();
                    const left = ((start - bounds!.min) / bounds!.span) * 100;
                    const width = Math.max(
                      ((end - start) / bounds!.span) * 100,
                      2,
                    );
                    return (
                      <div
                        className={`absolute top-0 h-7 rounded ${STATUS_BAR[epic.status]} flex items-center px-2`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${STATUS_LABEL[epic.status]} · ${fmt(new Date(start))}–${fmt(new Date(end))}`}
                      >
                        <span className="text-[11px] text-foreground/80 truncate">
                          {epic.sprintCount} sprint
                          {epic.sprintCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    );
                  })()
                ) : (
                  <span
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground italic"
                    title={STATUS_LABEL[epic.status]}
                  >
                    No dates yet
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
