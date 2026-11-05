import { Pencil, Plus } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import { dateRange } from "~/education/lib/taskboard/labels";
import { periodEnd, sortPeriods, type WeekRef } from "~/education/lib/taskboard/weeks";
import type { Dialog, TaskboardData } from "./types";

export function YearView({
  data,
  openPeriod,
  openDialog,
}: {
  data: TaskboardData;
  openPeriod: (ref: WeekRef) => void;
  openDialog: (d: Dialog) => void;
}) {
  const { periods, milestones, current } = data;
  const sorted = sortPeriods(periods);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-os-grey">Terms, interims and their milestones</p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {sorted.map((p) => {
          const ms = milestones.filter((m) => m.periodId === p.id);
          const isCurrent = current?.periodId === p.id;
          return (
            <div
              key={p.id}
              style={{ flexGrow: p.weekCount, flexBasis: `${p.weekCount * 28}px` }}
              className="relative flex min-w-[180px]"
            >
            <button
              type="button"
              onClick={() => openPeriod({ periodId: p.id, week: isCurrent && current ? current.week : 1 })}
              className={cn(
                "flex w-full flex-col gap-2 rounded-os-card p-4 text-left transition-colors hover:bg-os-card-hover",
                p.kind === "Term" ? "bg-os-card" : "border border-dashed border-os-container-hi bg-os-bg",
                isCurrent && "border-2 border-solid border-os-accent bg-os-bg",
              )}
            >
              <span className="font-semibold text-os-fg">{p.name}</span>
              <span className="text-sm text-os-grey">{dateRange(p.startDate, periodEnd(p))}</span>
              <span className="flex flex-wrap gap-1.5">
                {ms.slice(0, 3).map((m) => (
                  <span key={m.id} className="rounded-full bg-os-milestone-tint px-2 py-0.5 text-xs font-semibold text-os-milestone">
                    {m.name}
                  </span>
                ))}
              </span>
              <span className="mt-auto text-xs text-os-grey">
                {isCurrent && current ? `Week ${current.week} now · ` : ""}
                {ms.length} {ms.length === 1 ? "milestone" : "milestones"}
              </span>
            </button>
            <IconButton
              label="Edit term"
              icon={Pencil}
              className="absolute right-3 top-3"
              onClick={() => openDialog({ kind: "period", periodId: p.id })}
            />
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => openDialog({ kind: "period", periodId: null })}
          className="flex min-w-[140px] flex-col items-center justify-center gap-1 rounded-os-card border border-dashed border-os-container-hi p-4 text-os-grey hover:bg-os-card-hover"
        >
          <Plus className="h-5 w-5" aria-hidden />
          Add term
        </button>
      </div>
      <p className="text-sm text-os-grey">Click a term to see it week by week.</p>
    </div>
  );
}
