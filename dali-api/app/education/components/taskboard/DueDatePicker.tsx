import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "~/components/ui/floating/Popover";
import { usePanelClass } from "~/components/ui/floating/os-styles";
import { cn } from "~/lib/cn";
import {
  dateToRef,
  daysWithTasks,
  dueLabel,
  initialMonth,
  monthRows,
  monthTitle,
  refToDate,
  shiftMonth,
  weekLoad,
  type DueRef,
} from "~/education/lib/taskboard/calendar";
import type { BoardMember, StoredTask } from "~/education/lib/taskboard/taskboard.server";
import type { BoardPeriod } from "~/education/lib/taskboard/weeks";

const DAY_HEADS = ["S", "M", "T", "W", "T", "F", "S"];

export function DueDatePicker({
  value,
  periods,
  tasks,
  members,
  excludeTaskId,
  todayYmd,
  onChange,
}: {
  value: DueRef;
  periods: BoardPeriod[];
  tasks: StoredTask[];
  members: BoardMember[];
  excludeTaskId: string | null;
  todayYmd: string;
  onChange: (ref: DueRef) => void;
}) {
  const label = dueLabel(periods, value);
  return (
    <Popover
      ariaLabel="Due date"
      panelClassName={cn(usePanelClass(), "w-[360px] max-w-[92vw] !p-3")}
      trigger={
        <button
          type="button"
          className="flex h-[42px] w-full items-center gap-2 rounded-os-field border border-os-container bg-os-bg px-3 text-left text-sm"
        >
          <span className="font-bold text-os-fg">{label.main}</span>
          <span className="text-os-grey">{label.day}</span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-os-grey" aria-hidden />
        </button>
      }
    >
      {(close) => (
        <Calendar
          value={value}
          periods={periods}
          tasks={tasks}
          members={members}
          excludeTaskId={excludeTaskId}
          todayYmd={todayYmd}
          onPick={(ref) => {
            onChange(ref);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function Calendar({
  value,
  periods,
  tasks,
  members,
  excludeTaskId,
  todayYmd,
  onPick,
}: {
  value: DueRef;
  periods: BoardPeriod[];
  tasks: StoredTask[];
  members: BoardMember[];
  excludeTaskId: string | null;
  todayYmd: string;
  onPick: (ref: DueRef) => void;
}) {
  const [{ year, month }, setMonth] = useState(() => initialMonth(periods, value, todayYmd));
  const rows = useMemo(() => monthRows(periods, year, month), [periods, year, month]);
  const marked = useMemo(() => daysWithTasks(tasks, periods), [tasks, periods]);
  const selected = refToDate(periods, value);
  const load = weekLoad(tasks, members, value, excludeTaskId);
  const nav = "os-icon-btn";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-os-fg">{monthTitle(year, month)}</p>
          <p className="text-xs text-os-grey">Week numbers on the left</p>
        </div>
        <span className="flex gap-1">
          <button type="button" className={nav} aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m.year, m.month, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" className={nav} aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m.year, m.month, 1))}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-[44px_repeat(7,1fr)] gap-y-1 text-center text-sm">
        <span />
        {DAY_HEADS.map((d, i) => (
          <span key={i} className="text-xs font-bold text-os-grey">
            {d}
          </span>
        ))}
        {rows.map((row, r) => {
          const inValueWeek = row.cells.some((c) => c && selected && dateToRef(periods, c.ymd)?.week === value.week && dateToRef(periods, c.ymd)?.periodId === value.periodId);
          return [
            <span key={`l${r}`} className={cn("flex items-center justify-start pl-1 text-xs font-semibold", inValueWeek ? "text-os-fg" : "text-os-grey")}>
              {row.label}
            </span>,
            ...row.cells.map((cell, c) => {
              if (!cell) return <span key={`${r}-${c}`} />;
              const ref = dateToRef(periods, cell.ymd);
              const isSelected = cell.ymd === selected;
              return (
                <button
                  key={cell.ymd}
                  type="button"
                  disabled={!ref}
                  aria-label={ref ? `${monthTitle(year, month).split(" ")[0]} ${cell.day}` : `${cell.day}, outside any term`}
                  aria-pressed={isSelected}
                  onClick={() => ref && onPick(ref)}
                  className={cn(
                    "relative mx-auto flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                    isSelected
                      ? "bg-os-accent font-bold text-os-bg"
                      : inValueWeek
                        ? "bg-os-accent-tint text-os-fg hover:bg-os-card-hover"
                        : "text-os-fg hover:bg-os-hover",
                    !ref && "cursor-not-allowed text-os-muted opacity-50 hover:bg-transparent",
                  )}
                >
                  {cell.day}
                  {marked.has(cell.ymd) && (
                    <span className={cn("absolute bottom-1 h-1 w-1 rounded-full", isSelected ? "bg-os-bg" : "bg-os-amber")} aria-hidden />
                  )}
                </button>
              );
            }),
          ];
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-os-container pt-3 text-xs">
        <span className="font-semibold text-os-grey">Week {value.week} load:</span>
        {load.length === 0 && <span className="text-os-grey">No tasks yet</span>}
        {load.map((l) => (
          <span key={l.userId} className="inline-flex items-center gap-1.5 rounded-full bg-os-card px-2.5 py-1 font-semibold text-os-fg">
            <span className={cn("h-2 w-2 rounded-full", l.tone === "busy" ? "bg-os-amber" : "bg-os-green")} aria-hidden />
            {l.name.split(" ")[0]} {l.count} {l.count === 1 ? "task" : "tasks"}
          </span>
        ))}
      </div>
    </div>
  );
}
