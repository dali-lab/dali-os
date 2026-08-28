// Compact month navigator — a 6×7 date picker for jumping the calendar to any
// day (the mini-month every reference calendar carries). Self-contained: it
// tracks the month it's showing, pages with the chevrons, and calls onPick with
// the chosen day at UTC midnight (matching the rest of the calendar's UTC-anchored
// day math). Today and the currently-viewed day are highlighted.

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "~/lib/cn";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function ymdKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function MiniMonth({
  focusDate,
  timezone,
  onPick,
}: {
  /** The day the calendar is currently centered on (opens on its month). */
  focusDate: Date;
  timezone: string;
  onPick: (dateUtc: Date) => void;
}) {
  const [shown, setShown] = useState({
    year: focusDate.getUTCFullYear(),
    month: focusDate.getUTCMonth(), // 0-based
  });

  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const focusKey = ymdKey(focusDate);

  const firstUtc = new Date(Date.UTC(shown.year, shown.month, 1));
  const gridStart = new Date(firstUtc.getTime() - firstUtc.getUTCDay() * 86_400_000);
  const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * 86_400_000));

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(firstUtc);

  const step = (delta: number) =>
    setShown((s) => {
      const d = new Date(Date.UTC(s.year, s.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });

  return (
    <div className="w-64 select-none p-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous month"
            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next month"
            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i} className="grid h-6 place-items-center text-[10px] font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const key = ymdKey(d);
          const inMonth = d.getUTCMonth() === shown.month;
          const isToday = key === todayKey;
          const isFocus = key === focusKey;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())))}
              className={cn(
                "grid h-8 place-items-center rounded-md text-xs",
                isToday
                  ? "bg-accent-coral font-semibold text-white"
                  : isFocus
                    ? "bg-muted font-semibold text-foreground"
                    : inMonth
                      ? "text-foreground hover:bg-muted"
                      : "text-muted-foreground hover:bg-muted",
              )}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
