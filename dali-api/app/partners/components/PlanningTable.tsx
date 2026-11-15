import { useCallback, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { stringSetCodec, usePersistedState } from "~/hooks/usePersistedState";
import type { PlanningDomainRow, PlanningGapModel } from "../lib/planning-gap";
import { SourceBar } from "./planning/SourceBar";
import { GapPill } from "./planning/GapPill";
import { DomainBreakdown, PLANNING_GRID as GRID } from "./planning/DomainBreakdown";

export const PLANNING_OPEN_KEY = "partner-planning-open";

export function spotsLabel(renewing: number, fresh: number): string {
  const total = renewing + fresh;
  if (total === 0) return "0";
  return `${total} (${renewing} renewing, ${fresh} new)`;
}

const isStringSet = (v: unknown): v is Set<string> => v instanceof Set;

function useOpenDomains() {
  const [open, setOpen] = usePersistedState<Set<string>>(PLANNING_OPEN_KEY, new Set(), isStringSet, stringSetCodec);
  const toggle = useCallback(
    (id: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [setOpen],
  );
  return { open, toggle };
}

function DomainRow({
  row,
  scale,
  isOpen,
  onToggle,
  onRowClick,
}: {
  row: PlanningDomainRow;
  scale: number;
  isOpen: boolean;
  onToggle: () => void;
  onRowClick: (kind: "project" | "application", refId: string) => void;
}) {
  const hasBar = row.spots > 0 || row.intent > 0;
  return (
    <div className="border-t border-os-container first:border-t-0">
      <div
        onClick={onToggle}
        className={cn(GRID, "cursor-pointer py-3 text-sm transition-colors hover:bg-os-card-hover")}
      >
        <button
          type="button"
          aria-expanded={isOpen}
          className="flex min-w-0 items-center gap-2 text-left font-medium text-foreground"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")}
            aria-hidden
          />
          <span className="truncate">{row.name}</span>
        </button>
        <span className="tabular-nums text-foreground">{row.spots}</span>
        <span className="tabular-nums text-foreground">{row.intent}</span>
        <div onClick={(e) => e.stopPropagation()}>
          {hasBar && (
            <Tooltip
              variant="rich"
              content={
                <div className="flex flex-col gap-0.5">
                  <span>Renewing {row.renewing}</span>
                  <span>New {row.fresh}</span>
                  <span>Intent to work {row.intent}</span>
                </div>
              }
            >
              <div tabIndex={0} className="py-1">
                <SourceBar renewing={row.renewing} fresh={row.fresh} intent={row.intent} scale={scale} />
              </div>
            </Tooltip>
          )}
        </div>
        <span>
          <GapPill gap={row.gap} />
        </span>
      </div>
      {isOpen && row.items.length > 0 && (
        <DomainBreakdown items={row.items} onRowClick={onRowClick} />
      )}
    </div>
  );
}

export function PlanningTable({
  model,
  noDomainNote = true,
  onRowClick,
}: {
  model: PlanningGapModel;
  noDomainNote?: boolean;
  onRowClick: (kind: "project" | "application", refId: string) => void;
}) {
  const { open, toggle } = useOpenDomains();
  const [emptyOpen, setEmptyOpen] = useState(false);
  const { rows, empty, totals } = model;

  const scale = useMemo(
    () => Math.max(1, ...rows.map((r) => Math.max(r.spots, r.intent)), totals.spots),
    [rows, totals.spots],
  );
  const totalGap = totals.shortfall;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-os-card bg-os-card">
        <div className="min-w-[720px]">
          <div className={cn(GRID, "py-2.5 text-xs font-medium text-muted-foreground")}>
            <span>Domain</span>
            <span>Spots</span>
            <span>Intent to work</span>
            <span className="flex items-center gap-3">
              Spots by source
              <span className="flex items-center gap-1.5 font-normal">
                <span className="inline-block h-2 w-2 rounded-full bg-os-accent" aria-hidden />
                Renewing
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, var(--color-os-accent) 0 1px, transparent 1px 3px)",
                    boxShadow: "inset 0 0 0 1px var(--color-os-accent)",
                  }}
                  aria-hidden
                />
                New
                <span className="inline-block h-2 w-2 rounded-full bg-os-grey/50" aria-hidden />
                Intent to work
              </span>
            </span>
            <span>Gap</span>
          </div>

          {rows.map((row) => (
            <DomainRow
              key={row.domainId}
              row={row}
              scale={scale}
              isOpen={open.has(row.domainId)}
              onToggle={() => toggle(row.domainId)}
              onRowClick={onRowClick}
            />
          ))}

          <div className={cn(GRID, "border-t border-os-container-hi py-3 text-sm font-semibold text-foreground")}>
            <span>Total</span>
            <span className="tabular-nums">{spotsLabel(totals.renewing, totals.fresh)}</span>
            <span className="tabular-nums">
              {totals.intent}
              {totals.people !== totals.intent && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({totals.people} {totals.people === 1 ? "person" : "people"})
                </span>
              )}
            </span>
            <SourceBar
              renewing={totals.renewing}
              fresh={totals.fresh}
              intent={totals.intent}
              scale={Math.max(1, totals.spots, totals.intent)}
            />
            <span>
              <GapPill gap={totalGap} />
            </span>
          </div>

          {empty.length > 0 && (
            <div className="border-t border-os-container">
              <button
                type="button"
                aria-expanded={emptyOpen}
                onClick={() => setEmptyOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground hover:bg-os-card-hover"
              >
                <ChevronRight
                  className={cn("h-3.5 w-3.5 shrink-0 transition-transform", emptyOpen && "rotate-90")}
                  aria-hidden
                />
                <span className="font-medium text-foreground">No spots or people</span>
                <span className="rounded-full bg-os-container/70 px-2 py-0.5 text-xs tabular-nums text-foreground">
                  {empty.length}
                </span>
                {!emptyOpen && <span className="min-w-0 truncate">{empty.map((r) => r.name).join(", ")}</span>}
              </button>
              {emptyOpen &&
                empty.map((row) => (
                  <div key={row.domainId} className={cn(GRID, "border-t border-os-container py-3 text-sm")}>
                    <span className="pl-5 text-foreground">{row.name}</span>
                    <span className="tabular-nums text-foreground">0</span>
                    <span className="tabular-nums text-foreground">0</span>
                    <span />
                    <GapPill gap={0} />
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
      {noDomainNote && totals.noDomain > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {totals.noDomain} returning with no domain
        </p>
      )}
    </div>
  );
}
