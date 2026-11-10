import { Pencil } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { dateRange, shortDate, weeksLabel } from "~/education/lib/taskboard/labels";
import { periodEnd, weekStart, type WeekRef } from "~/education/lib/taskboard/weeks";
import type { Dialog, TaskboardData } from "./types";

export function TermView({
  data,
  openWeek,
  openDialog,
}: {
  data: TaskboardData;
  openWeek: (ref: WeekRef) => void;
  openDialog: (d: Dialog) => void;
}) {
  const { periods, milestones, tasks, current, viewed } = data;
  const period = periods.find((p) => p.id === viewed?.periodId);
  if (!period) return <p className="text-os-grey">Add a term to start planning.</p>;

  const ms = milestones.filter((m) => m.periodId === period.id);
  const weeks = Array.from({ length: period.weekCount }, (_, i) => i + 1);
  const looseCount = (w: number) =>
    tasks.filter((t) => t.periodId === period.id && t.week === w && !t.milestoneId && t.status !== "Done").length;
  const progress = (id: string) => {
    const own = tasks.filter((t) => t.milestoneId === id);
    return { done: own.filter((t) => t.status === "Done").length, total: own.length };
  };
  const cols = { gridTemplateColumns: `repeat(${period.weekCount}, minmax(80px, 1fr))` };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-heading text-2xl font-medium text-os-fg">{period.name}</h2>
        <span className="text-os-grey">
          {dateRange(period.startDate, periodEnd(period))} · {weeksLabel(period.weekCount)}
        </span>
        <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: "period", periodId: period.id })}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit term
        </Button>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[960px] flex-col gap-2">
          <div className="grid gap-1.5" style={cols}>
            {weeks.map((w) => {
              const isNow = current?.periodId === period.id && current.week === w;
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => openWeek({ periodId: period.id, week: w })}
                  className={cn(
                    "flex flex-col items-start rounded-os-item px-3 py-2 text-left transition-colors hover:bg-os-card-hover",
                    isNow ? "bg-(--tb-accent-tint)" : "bg-os-card",
                  )}
                >
                  <span className="text-sm font-semibold text-os-fg">Wk {w}</span>
                  <span className="text-xs text-os-grey">{shortDate(weekStart(period, w))}</span>
                </button>
              );
            })}
          </div>

          {ms.length === 0 && (
            <p className="py-6 text-center text-os-grey">No milestones yet. Use Add, then Milestone.</p>
          )}
          {ms.map((m) => {
            const { done, total } = progress(m.id);
            return (
              <div key={m.id} className="grid gap-1.5" style={cols}>
                <button
                  type="button"
                  onClick={() => openDialog({ kind: "milestone-detail", milestoneId: m.id })}
                  style={{ gridColumn: `${m.startWeek} / ${m.endWeek + 1}` }}
                  className="flex items-center gap-2 rounded-os-item bg-(--tb-milestone-tint) px-3 py-2 text-left text-sm font-semibold text-os-fg hover:bg-os-card-hover"
                >
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto shrink-0 text-xs font-medium text-os-grey">
                    {done}/{total}
                  </span>
                </button>
              </div>
            );
          })}

          <div className="grid gap-1.5" style={cols}>
            {weeks.map((w) => (
              <span key={w} className="px-3 text-xs text-os-grey">
                {looseCount(w)} loose
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="text-sm text-os-grey">
        Click a milestone to see its tasks. Click a week to open its board. Loose tasks show as a count per week.
      </p>
    </div>
  );
}
