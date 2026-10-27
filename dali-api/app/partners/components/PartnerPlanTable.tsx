import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { useToast } from "~/components/ui/toast";
import { formatUsd } from "~/lib/money";
import { cn } from "~/lib/cn";
import { PARTNER_STAGE_LABELS, isStale } from "../lib/partner-application";
import { usePlannerAutosave } from "../lib/use-planner-autosave";
import {
  PARTNER_PLANNING_DOT,
  PARTNER_PLANNING_PILL,
  PARTNER_PLANNING_STATUSES,
  groupTotals,
  type PartnerPlanningStatus,
  type PlanTermEntry,
  type PlannerGroup,
  type PlannerRow,
} from "../lib/partner-planning";
import { stageAccent } from "./PartnerBoard";

type DomainColumn = { id: string; name: string };

const TH = "px-3 py-2 text-left font-medium";
const CELL_INPUT =
  "w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed";

export function PartnerPlanTable({
  groups,
  domains,
  planning,
  staleDays,
  onOpen,
}: {
  groups: PlannerGroup[];
  domains: DomainColumn[];
  planning: boolean;
  staleDays: number;
  onOpen: (id: string) => void;
}) {
  const colCount = 3 + (planning ? 3 : 0) + domains.length;

  return (
    <div className="overflow-x-auto rounded-lg border border-os-container bg-os-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/30 text-xs text-muted-foreground">
          <tr>
            {planning && <th className={cn(TH, "w-32")}>Plan</th>}
            <th className={cn(TH, "min-w-[200px]")}>Application</th>
            <th className={cn(TH, "w-28")}>Stage</th>
            {planning && <th className={cn(TH, "min-w-[200px]")}>Notes</th>}
            {planning && <th className={cn(TH, "min-w-[160px]")}>To-do</th>}
            <th className={cn(TH, "w-24 text-right")}>Fee</th>
            {domains.map((d) => (
              <th key={d.id} className={cn(TH, "w-16 text-center")} title={d.name}>
                {shortDomain(d.name)}
              </th>
            ))}
          </tr>
        </thead>
        {groups.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={colCount} className="px-3 py-8 text-center text-muted-foreground">
                No applications match these filters.
              </td>
            </tr>
          </tbody>
        ) : (
          groups.map((g) => (
            <tbody key={g.key}>
              {groups.length > 1 && (
                <tr className="border-t border-os-container">
                  <td colSpan={colCount} className="px-3 pt-4 pb-1 text-sm font-medium text-foreground">
                    {g.label}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{g.rows.length}</span>
                  </td>
                </tr>
              )}
              {g.rows.map((row) => (
                <PlanRow
                  key={`${row.card.id}:${row.entry?.termId ?? "none"}`}
                  row={row}
                  domains={domains}
                  planning={planning}
                  staleDays={staleDays}
                  onOpen={onOpen}
                />
              ))}
              <TotalRow rows={g.rows} domains={domains} planning={planning} />
            </tbody>
          ))
        )}
      </table>
    </div>
  );
}

function TotalRow({
  rows,
  domains,
  planning,
}: {
  rows: PlannerRow[];
  domains: DomainColumn[];
  planning: boolean;
}) {
  const { feeCents, members } = groupTotals(rows);
  return (
    <tr className="border-t border-os-container text-xs text-muted-foreground">
      <td colSpan={planning ? 5 : 2} className="px-3 py-2">
        Total
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-foreground">
        {feeCents > 0 ? formatUsd(feeCents / 100) : ""}
      </td>
      {domains.map((d) => (
        <td key={d.id} className="px-2 py-2 text-center tabular-nums text-foreground">
          {members.get(d.id) || ""}
        </td>
      ))}
    </tr>
  );
}

function PlanRow({
  row,
  domains,
  planning,
  staleDays,
  onOpen,
}: {
  row: PlannerRow;
  domains: DomainColumn[];
  planning: boolean;
  staleDays: number;
  onOpen: (id: string) => void;
}) {
  const { os } = useOsChrome();
  const { card, entry } = row;
  const accent = stageAccent(card.stage, os);
  const stale = isStale(card, staleDays);

  return (
    <tr className="border-t border-os-container align-top hover:bg-os-card-hover">
      {planning && (
        <td className="px-3 py-2">
          {entry && <PlanningStatusSelect entry={entry} title={card.title} />}
        </td>
      )}
      <td className="px-3 py-2">
        <button
          type="button"
          className="text-left font-medium text-foreground hover:underline"
          onClick={() => onOpen(card.id)}
        >
          {card.title}
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {card.partnerName}
          {stale && <span className="text-os-amber">Stale</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        <span
          className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: accent.fill, color: accent.ink }}
        >
          {PARTNER_STAGE_LABELS[card.stage]}
        </span>
      </td>
      {planning && (
        <td className="px-3 py-2">
          {entry && (
            <AutoSaveTextCell
              initial={entry.plannerNotes ?? ""}
              targetTermId={entry.targetTermId}
              field="plannerNotes"
              label="Notes"
            />
          )}
        </td>
      )}
      {planning && (
        <td className="px-3 py-2">
          {entry && (
            <AutoSaveTextCell
              initial={entry.plannerTodo ?? ""}
              targetTermId={entry.targetTermId}
              field="plannerTodo"
              label="To-do"
            />
          )}
        </td>
      )}
      <td className="px-3 py-2 text-right text-xs tabular-nums text-foreground">
        {card.feeCents != null ? formatUsd(card.feeCents / 100) : ""}
      </td>
      {domains.map((d) => {
        const cell = card.headcount.find((h) => h.domainId === d.id);
        return (
          <td key={d.id} className="px-2 py-2 text-center">
            <MemberCountCell
              label={`${d.name} headcount for ${card.title}`}
              applicationId={card.id}
              domainId={d.id}
              existingRowId={cell?.id ?? null}
              initial={cell?.expectedMembers ?? 0}
            />
          </td>
        );
      })}
    </tr>
  );
}

const UNSET = "unset";
type StatusValue = PartnerPlanningStatus | typeof UNSET;
const STATUS_OPTIONS: SelectOption<StatusValue>[] = [
  ...PARTNER_PLANNING_STATUSES.map((s) => ({
    value: s,
    label: s,
    icon: <span className={cn("inline-block h-2 w-2 rounded-full", PARTNER_PLANNING_DOT[s])} />,
  })),
  { value: UNSET, label: "No status" },
];

function PlanningStatusSelect({ entry, title }: { entry: PlanTermEntry; title: string }) {
  const toast = useToast();
  const revalidator = useRevalidator();
  const [saving, setSaving] = useState(false);
  const current = entry.planningStatus;

  async function pick(next: StatusValue) {
    const planningStatus = next === UNSET ? null : next;
    if (saving || planningStatus === current) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/partner-application-target-terms/${entry.targetTermId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planningStatus }),
      });
      if (!res.ok) throw new Error("save failed");
      await revalidator.revalidate();
    } catch {
      toast.error("Couldn't save the plan status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Select<StatusValue>
      value={current ?? UNSET}
      options={STATUS_OPTIONS}
      onChange={(v) => void pick(v)}
      disabled={saving}
      ariaLabel={`Plan status for ${title} in ${entry.code}`}
      buttonClassName={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        current ? PARTNER_PLANNING_PILL[current] : "bg-os-container text-muted-foreground",
      )}
    />
  );
}

function AutoSaveTextCell({
  initial,
  targetTermId,
  field,
  label,
}: {
  initial: string;
  targetTermId: string;
  field: "plannerNotes" | "plannerTodo";
  label: string;
}) {
  const toast = useToast();
  const { value, change, flush } = usePlannerAutosave(
    initial,
    async (next) => {
      const res = await fetch(`/api/partner-application-target-terms/${targetTermId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next.trim() === "" ? null : next }),
      });
      if (!res.ok) throw new Error("save failed");
    },
    () => toast.error(`Couldn't save ${label.toLowerCase()}.`),
  );

  return (
    <textarea
      className={cn(CELL_INPUT, "resize-none")}
      rows={2}
      placeholder={label}
      value={value}
      aria-label={label}
      onChange={(e) => change(e.target.value)}
      onBlur={() => void flush()}
    />
  );
}

const MAX_INT = 2_147_483_647;

function MemberCountCell({
  applicationId,
  domainId,
  existingRowId,
  initial,
  label,
}: {
  applicationId: string;
  domainId: string;
  existingRowId: string | null;
  initial: number;
  label: string;
}) {
  const rowId = useRef(existingRowId);
  const toast = useToast();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (existingRowId) rowId.current = existingRowId;
  }, [existingRowId]);

  const { value, change, flush } = usePlannerAutosave(
    initial,
    async (next) => {
      let id = rowId.current;
      if (!id) {
        if (next <= 0) return;
        const createRes = await fetch(`/api/partner-applications/${applicationId}/domains`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domainId }),
        });
        if (!createRes.ok) throw new Error("create failed");
        id = ((await createRes.json()) as { id: string }).id;
        rowId.current = id;
      }
      const res = await fetch(`/api/partner-application-domains/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedMembers: next }),
      });
      if (!res.ok) throw new Error("save failed");
      await revalidator.revalidate();
    },
    () => toast.error("Couldn't save headcount."),
  );

  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_INT}
      className={cn(CELL_INPUT, "w-12 text-center tabular-nums")}
      value={value === 0 ? "" : value}
      aria-label={label}
      onChange={(e) =>
        change(Math.min(MAX_INT, Math.max(0, Math.floor(Number(e.target.value) || 0))))
      }
      onBlur={() => void flush()}
    />
  );
}

export function shortDomain(name: string): string {
  const trimmed = name.replace(/\s*Dev$/i, "").trim();
  return trimmed.length > 12 ? `${trimmed.slice(0, 10)}…` : trimmed;
}
