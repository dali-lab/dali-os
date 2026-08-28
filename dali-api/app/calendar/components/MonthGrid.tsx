// Month view — a 5–6 row date matrix of event chips. Shares the layer data with
// the week/day grid (same merged EventBlocks) but renders each as a compact chip
// rather than a time-positioned block. Clicking a day drills into Day view;
// clicking a chip drills into that day too (the detail popover is a time-grid
// affordance).

import { cn } from "~/lib/cn";
import { readableTextColor } from "~/calendar/lib/event-block";
import type { GridDay } from "~/calendar/lib/layers";
import type { EventBlock } from "~/calendar/lib/types";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

function MonthChip({ block, onOpen }: { block: EventBlock; onOpen: () => void }) {
  const style = block.bgColor
    ? { backgroundColor: block.bgColor, color: readableTextColor(block.bgColor) }
    : undefined;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      style={style}
      title={block.label}
      className={cn(
        "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-tight",
        block.bgColor ? "" : block.className,
      )}
    >
      {block.label}
    </button>
  );
}

export function MonthGrid({
  days,
  eventsByDay,
  anchorMonth,
  timezone,
  onSelectDay,
}: {
  days: GridDay[];
  eventsByDay: Record<number, EventBlock[]>;
  /** The 1-based month (and year) the view is centered on — days outside it are dimmed. */
  anchorMonth: { year: number; month: number };
  timezone: string;
  /** Drill into a day: called with the column's UTC-anchored date. */
  onSelectDay: (dateUtc: Date) => void;
}) {
  const todayYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"

  const rows: GridDay[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="border-b border-border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
        {days.map((day, idx) => {
          const inMonth =
            day.dateUtc.getUTCFullYear() === anchorMonth.year &&
            day.dateUtc.getUTCMonth() + 1 === anchorMonth.month;
          const dayKey = `${day.dateUtc.getUTCFullYear()}-${String(day.dateUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(
            day.dateUtc.getUTCDate(),
          ).padStart(2, "0")}`;
          const isToday = dayKey === todayYmd;
          const blocks = (eventsByDay[idx] ?? []).slice().sort((a, b) => a.startHour - b.startHour);
          const shown = blocks.slice(0, MAX_CHIPS);
          const overflow = blocks.length - shown.length;
          return (
            <button
              type="button"
              key={idx}
              onClick={() => onSelectDay(day.dateUtc)}
              className={cn(
                "flex min-h-0 flex-col gap-0.5 border-b border-r border-border p-1 text-left align-top transition-colors hover:bg-muted",
                idx % 7 === 0 && "border-l",
                !inMonth && "bg-muted/40 text-muted-foreground",
              )}
            >
              <div className="flex items-center justify-between px-1">
                <span
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-full text-xs font-semibold",
                    isToday ? "bg-accent-coral text-white" : inMonth ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {day.dateUtc.getUTCDate()}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {shown.map((b, i) => (
                  <MonthChip key={i} block={b} onOpen={() => onSelectDay(day.dateUtc)} />
                ))}
                {overflow > 0 && (
                  <span className="px-1.5 text-[11px] font-medium text-muted-foreground">+{overflow} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
