import { useId } from "react";
import { assigneeNames } from "~/education/lib/taskboard/assignees";
import { PanelFrame } from "./PanelFrame";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { firstName, WEEKDAYS } from "~/education/lib/taskboard/labels";
import type { Dialog, TaskboardData } from "./types";

export function MilestoneDetail({
  data,
  milestoneId,
  onClose,
  openDialog,
}: {
  data: TaskboardData;
  milestoneId: string;
  onClose: () => void;
  openDialog: (d: Dialog) => void;
}) {
  const titleId = useId();
  const { periods, members, current, userId } = data;
  const milestone = data.milestones.find((m) => m.id === milestoneId);
  if (!milestone) return null;
  const short = periods.find((p) => p.id === milestone.periodId)?.shortName ?? "";
  const tasks = data.tasks.filter((t) => t.milestoneId === milestone.id);
  const done = tasks.filter((t) => t.status === "Done").length;
  const pct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  const weeks = Array.from({ length: milestone.endWeek - milestone.startWeek + 1 }, (_, i) => milestone.startWeek + i).filter((w) =>
    tasks.some((t) => t.week === w),
  );
  const assigneeLabel = (ids: string[]) => {
    const names = assigneeNames(ids, members).map(firstName);
    return names.length > 0 ? names.join(", ") : "Unassigned";
  };
  const isThisWeek = (w: number) => current?.periodId === milestone.periodId && current.week === w;

  return (
    <PanelFrame width={680} labelledBy={titleId} onClose={onClose}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-os-grey">Milestone</p>
          <h2 id={titleId} className="mt-1 flex items-center gap-2 text-[22px] font-medium text-os-fg">
            <span className="truncate">{milestone.name}</span>
          </h2>
        </div>
        <span className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: "milestone", milestoneId: milestone.id })}>
            Edit
          </Button>
          <button type="button" onClick={onClose} aria-label="Close" className="os-icon-btn">
            ×
          </button>
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-(--tb-milestone-tint) px-3 py-1 text-xs font-semibold text-(--tb-milestone)">
          {short} · Wk {milestone.startWeek} to {milestone.endWeek}
        </span>
        <span className="rounded-full bg-os-card px-3 py-1 text-xs font-semibold text-os-fg">
          {done}/{tasks.length} done
        </span>
      </div>
      {milestone.description && <p className="mb-4 text-os-grey">{milestone.description}</p>}
      <div className="mb-5 h-2 overflow-hidden rounded-full bg-os-well" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-(--tb-milestone)" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-col gap-4">
        {weeks.map((w) => (
          <section key={w}>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-os-grey">
              Week {w}
              {isThisWeek(w) && <span className="ml-1 normal-case text-os-accent"> · this week</span>}
            </h3>
            <ul className="flex flex-col gap-1">
              {tasks
                .filter((t) => t.week === w)
                .map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => openDialog({ kind: "task", taskId: t.id })}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-os-item px-3 py-2 text-left hover:bg-os-hover",
                        t.assigneeIds.length === 0 && "border border-dashed border-os-container-hi",
                      )}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          t.status === "Done" ? "bg-os-green" : t.status === "Backlog" ? "bg-os-container-hi" : "bg-os-amber",
                        )}
                        aria-hidden
                      />
                      <span className={cn("min-w-0 flex-1 truncate font-semibold", t.status === "Done" && "text-os-grey line-through")}>
                        {t.title}
                      </span>
                      <span className="shrink-0 text-xs text-os-grey">
                        {assigneeLabel(t.assigneeIds)} · {WEEKDAYS[t.weekday]}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        {tasks.length === 0 && <p className="text-os-grey">No tasks yet.</p>}
      </div>
      <div className="mt-6 flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-os-item border border-dashed border-os-container-hi px-4 py-2 text-sm font-bold text-os-accent hover:bg-os-hover"
          onClick={() =>
            openDialog({
              kind: "task",
              taskId: null,
              draft: {
                milestoneId: milestone.id,
                periodId: milestone.periodId,
                week: milestone.startWeek,
                weekday: 4,
                assigneeIds: [userId],
              },
            })
          }
        >
          + Add task to this milestone
        </button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </PanelFrame>
  );
}
