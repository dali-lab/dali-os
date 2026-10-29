import { Link } from "react-router";
import { cn } from "~/lib/cn";
import { planningStateLabel, type PlanningBreakdownRow } from "../../lib/planning-gap";

export function breakdownHref(row: Pick<PlanningBreakdownRow, "kind" | "refId">): string {
  return row.kind === "application"
    ? `/core/partners?application=${row.refId}`
    : "/core/partners/renewals";
}

export function DomainBreakdown({ items }: { items: PlanningBreakdownRow[] }) {
  const renewals = items.filter((i) => i.source === "renewing");
  const fresh = items.filter((i) => i.source === "new");
  return (
    <div className="mx-3 mb-3 rounded-os-item bg-os-well p-1">
      {[renewals, fresh].map((group, gi) =>
        group.length === 0 ? null : (
          <div key={gi} className={cn(gi === 1 && renewals.length > 0 && "mt-1 border-t border-os-container pt-1")}>
            {group.map((row) => (
              <Link
                key={row.key}
                to={breakdownHref(row)}
                className={cn(
                  "flex items-center gap-3 rounded-os-item px-3 py-1.5 text-sm hover:bg-os-hover",
                  !row.counted && "opacity-45",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {row.iconEmoji && <span aria-hidden className="mr-1.5">{row.iconEmoji}</span>}
                  {row.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{planningStateLabel(row)}</span>
                <span className="w-6 shrink-0 text-right tabular-nums text-foreground">{row.count}</span>
              </Link>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
