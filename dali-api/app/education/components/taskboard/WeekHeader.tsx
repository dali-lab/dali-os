import { cn } from "~/lib/cn";
import { Button } from "~/components/ui/Button";
import { dateRange, relationLabel } from "~/education/lib/taskboard/labels";
import {
  relationToCurrent,
  weekEnd,
  weekStart,
  type BoardPeriod,
  type CurrentPosition,
  type WeekRef,
} from "~/education/lib/taskboard/weeks";

const DAY_MS = 86_400_000;

function weeksBetween(periods: BoardPeriod[], from: WeekRef, to: WeekRef): number {
  const a = periods.find((p) => p.id === from.periodId);
  const b = periods.find((p) => p.id === to.periodId);
  if (!a || !b) return 1;
  const diff = Date.parse(`${weekStart(b, to.week)}T00:00:00Z`) - Date.parse(`${weekStart(a, from.week)}T00:00:00Z`);
  return Math.max(1, Math.round(diff / (7 * DAY_MS)));
}

export function WeekHeader({
  periods,
  viewed,
  current,
  goTo,
}: {
  periods: BoardPeriod[];
  viewed: WeekRef;
  current: CurrentPosition;
  goTo: (ref: WeekRef) => void;
}) {
  const period = periods.find((p) => p.id === viewed.periodId);
  if (!period) return null;
  const relation = relationToCurrent(periods, viewed, current);
  const onCurrent = relation === "current";
  const weeks = Array.from({ length: period.weekCount }, (_, i) => i + 1);
  const range = dateRange(weekStart(period, viewed.week), weekEnd(period, viewed.week));

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-os-card bg-os-card px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[22px] font-semibold text-os-fg">Week {viewed.week}</h2>
        <span className="text-os-grey">{range}</span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            onCurrent ? "bg-(--tb-accent-tint) text-os-fg" : "bg-os-well text-os-grey",
          )}
        >
          {relationLabel(relation, weeksBetween(periods, current, viewed))}
        </span>
        {current.between && <span className="text-xs text-os-grey">Between terms</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Weeks">
        {weeks.map((w) => {
          const isViewed = w === viewed.week;
          const isNow = period.id === current.periodId && w === current.week;
          const isPast = relationToCurrent(periods, { periodId: period.id, week: w }, current) === "past";
          return (
            <button
              key={w}
              type="button"
              onClick={() => goTo({ periodId: period.id, week: w })}
              aria-current={isViewed ? "true" : undefined}
              aria-label={`Week ${w}${isNow ? ", this week" : ""}`}
              className={cn(
                "relative h-11 min-w-11 rounded-os-item px-2 text-sm font-semibold transition-colors",
                isViewed
                  ? "bg-os-accent text-os-bg"
                  : isPast
                    ? "bg-os-well text-os-grey hover:bg-os-card-hover"
                    : "bg-os-bg text-os-fg hover:bg-os-card-hover",
                isNow && !isViewed && "ring-2 ring-os-amber",
              )}
            >
              {w}
              {isNow && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-os-amber" aria-hidden />}
            </button>
          );
        })}
      </div>
      {!onCurrent && (
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => goTo({ periodId: current.periodId, week: current.week })}
        >
          Back to this week
        </Button>
      )}
    </div>
  );
}
