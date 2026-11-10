import { cn } from "~/lib/cn";
import { planningStateLabel, type PlanningBreakdownRow } from "../../lib/planning-gap";

// The planning table's column tracks — shared with the breakdown rows below a
// domain so a project's count sits in the same Spots column as its domain's.
export const PLANNING_GRID =
  "grid grid-cols-[minmax(150px,1.3fr)_minmax(110px,0.9fr)_minmax(90px,0.7fr)_minmax(160px,1.6fr)_minmax(90px,0.7fr)] items-center gap-4 px-4";

// Lines project names up under their domain's: the chevron (14px) + its gap (8px).
const INDENT = "pl-[22px]";

export function applicationHref(refId: string): string {
  return `/core/partners?application=${refId}`;
}

export function DomainBreakdown({
  items,
  onRowClick,
}: {
  items: PlanningBreakdownRow[];
  onRowClick: (kind: "project" | "application", refId: string) => void;
}) {
  const renewals = items.filter((i) => i.source === "renewing");
  const fresh = items.filter((i) => i.source === "new");
  const rowClass = (counted: boolean) =>
    cn(
      PLANNING_GRID,
      "py-1.5 text-left text-sm transition-colors hover:bg-os-hover",
      !counted && "opacity-45",
    );
  return (
    <div className="bg-os-well py-1">
      {[renewals, fresh].map((group, gi) =>
        group.length === 0 ? null : (
          <div key={gi}>
            <p className={cn(PLANNING_GRID, "pb-0.5 pt-1.5 text-xs font-medium text-muted-foreground")}>
              <span className={INDENT}>{gi === 0 ? "Renewing" : "New"}</span>
            </p>
            {group.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => onRowClick(row.kind, row.refId)}
                className={cn(rowClass(row.counted), "w-full")}
              >
                <BreakdownCells row={row} />
              </button>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function BreakdownCells({ row }: { row: PlanningBreakdownRow }) {
  return (
    <>
      <span className={cn(INDENT, "min-w-0 truncate text-foreground")}>
        {row.iconEmoji && <span aria-hidden className="mr-1.5">{row.iconEmoji}</span>}
        {row.name}
      </span>
      <span className="tabular-nums text-foreground">{row.count}</span>
      <span />
      <span className="text-xs text-muted-foreground">{planningStateLabel(row)}</span>
    </>
  );
}
