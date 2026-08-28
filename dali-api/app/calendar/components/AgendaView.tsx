// Agenda (list) view — the month's events as a chronological, day-grouped list
// instead of a time grid. Shares the merged EventBlocks the week/month grids use
// (timed events; all-day events live in a separate band and are omitted here).
// A row opens its event through the block's own handler (composer / timesheet
// editor), falling back to drilling into the day.

import { cn } from "~/lib/cn";
import type { GridDay } from "~/calendar/lib/layers";
import type { EventBlock } from "~/calendar/lib/types";

function fmtHour(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  const period = hours < 12 || hours === 24 ? "AM" : "PM";
  let h12 = hours % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mins).padStart(2, "0")} ${period}`;
}

function AgendaRow({ block, onDrill }: { block: EventBlock; onDrill: () => void }) {
  const dot = block.bgColor ?? undefined;
  return (
    <button
      type="button"
      onClick={(e) => {
        // Prefer the event's own action (composer for writable events, the
        // timesheet editor for logged entries); otherwise drill into the day.
        if (block.onEdit) block.onEdit(e.currentTarget.getBoundingClientRect());
        else if (block.onClick) block.onClick();
        else onDrill();
      }}
      className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
    >
      <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
        {fmtHour(block.startHour)}
      </span>
      <span
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        style={dot ? { backgroundColor: dot } : undefined}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{block.label}</span>
        {block.location && (
          <span className="block truncate text-xs text-muted-foreground">{block.location}</span>
        )}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {fmtHour(block.startHour + block.duration)}
      </span>
    </button>
  );
}

export function AgendaView({
  days,
  eventsByDay,
  timezone,
  onSelectDay,
}: {
  days: GridDay[];
  eventsByDay: Record<number, EventBlock[]>;
  timezone: string;
  onSelectDay: (dateUtc: Date) => void;
}) {
  const todayYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const rows = days
    .map((day, idx) => ({
      day,
      idx,
      blocks: (eventsByDay[idx] ?? []).slice().sort((a, b) => a.startHour - b.startHour),
    }))
    .filter((r) => r.blocks.length > 0);

  if (rows.length === 0) {
    return (
      <div className="grid flex-1 place-items-center py-16 text-sm text-muted-foreground">
        Nothing scheduled in this range.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 py-2">
        {rows.map(({ day, idx, blocks }) => {
          const dayKey = `${day.dateUtc.getUTCFullYear()}-${String(day.dateUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(
            day.dateUtc.getUTCDate(),
          ).padStart(2, "0")}`;
          const isToday = dayKey === todayYmd;
          const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(day.dateUtc);
          const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
            day.dateUtc,
          );
          return (
            <div key={idx} className="flex gap-3">
              <button
                type="button"
                onClick={() => onSelectDay(day.dateUtc)}
                className="flex w-14 shrink-0 flex-col items-center pt-1.5"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {weekday}
                </span>
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full text-sm font-semibold",
                    isToday ? "bg-accent-coral text-white" : "text-foreground",
                  )}
                >
                  {day.dateUtc.getUTCDate()}
                </span>
                <span className="sr-only">{monthDay}</span>
              </button>
              <div className="min-w-0 flex-1 border-l border-border pl-2">
                {blocks.map((b, i) => (
                  <AgendaRow key={i} block={b} onDrill={() => onSelectDay(day.dateUtc)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
