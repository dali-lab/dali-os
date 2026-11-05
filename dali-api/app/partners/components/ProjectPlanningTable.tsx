import { Link } from "react-router";
import { cn } from "~/lib/cn";
import { planningStateLabel, type PlanningProjectModel, type PlanningProjectRow } from "../lib/planning-gap";
import { applicationHref } from "./planning/DomainBreakdown";
import { spotsLabel } from "./PlanningTable";

const GRID = "grid grid-cols-[minmax(200px,1.6fr)_minmax(110px,0.7fr)_minmax(120px,0.8fr)_60px_minmax(200px,1.6fr)] items-center gap-4 px-4";

function ProjectRow({
  row,
  onProjectClick,
}: {
  row: PlanningProjectRow;
  onProjectClick: (projectId: string) => void;
}) {
  const cells = (
    <>
      <span className="min-w-0 truncate font-medium text-foreground">
        {row.iconEmoji && <span aria-hidden className="mr-1.5">{row.iconEmoji}</span>}
        {row.name}
      </span>
      <span className="text-xs text-muted-foreground">{planningStateLabel(row)}</span>
      <span className="min-w-0 truncate text-muted-foreground">{row.piName ?? "No PI"}</span>
      <span className="tabular-nums text-foreground">{row.spots}</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {row.domains.length > 0 ? row.domains.map((d) => `${d.name} ${d.count}`).join(", ") : "No spots set"}
      </span>
    </>
  );
  const rowClass = cn(
    GRID,
    "border-t border-os-container py-2.5 text-left text-sm transition-colors hover:bg-os-card-hover",
    !row.counted && "opacity-45",
  );
  if (row.kind === "application") {
    return (
      <Link to={applicationHref(row.refId)} className={rowClass}>
        {cells}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onProjectClick(row.refId)}
      className={cn(rowClass, "w-full")}
    >
      {cells}
    </button>
  );
}

function Group({
  label,
  rows,
  onProjectClick,
}: {
  label: string;
  rows: PlanningProjectRow[];
  onProjectClick: (projectId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <div className="flex items-center gap-2 border-t border-os-container px-4 py-2 text-xs font-medium text-muted-foreground">
        {label}
        <span className="rounded-full bg-accent-pink px-2 py-0.5 font-bold tabular-nums text-os-bg">
          {rows.length}
        </span>
      </div>
      {rows.map((row) => (
        <ProjectRow key={row.key} row={row} onProjectClick={onProjectClick} />
      ))}
    </>
  );
}

export function ProjectPlanningTable({
  model,
  termCode,
  onProjectClick,
}: {
  model: PlanningProjectModel;
  termCode: string;
  onProjectClick: (projectId: string) => void;
}) {
  const { renewing, fresh, totals } = model;
  if (renewing.length === 0 && fresh.length === 0) {
    return (
      <div className="rounded-os-card bg-os-card p-5 text-sm text-muted-foreground">
        No projects or applications for {termCode} yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-os-card bg-os-card">
      <div className="min-w-[840px]">
        <div className={cn(GRID, "py-2.5 text-xs font-medium text-muted-foreground")}>
          <span>Project</span>
          <span>State</span>
          <span>PI</span>
          <span>Spots</span>
          <span>Domains</span>
        </div>
        <Group label="Renewing" rows={renewing} onProjectClick={onProjectClick} />
        <Group label="New" rows={fresh} onProjectClick={onProjectClick} />
        <div className={cn(GRID, "border-t border-os-container-hi py-3 text-sm font-semibold text-foreground")}>
          <span>Total</span>
          <span />
          <span />
          <span className="col-span-2 tabular-nums">{spotsLabel(totals.renewing, totals.fresh)}</span>
        </div>
      </div>
    </div>
  );
}
