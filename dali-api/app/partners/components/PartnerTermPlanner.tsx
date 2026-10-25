import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useNavigate, useRevalidator } from "react-router";
import { ChevronDown, Columns3 } from "lucide-react";
import { TermFilter } from "~/components/TermFilter";
import { SearchInput } from "~/components/ui/SearchInput";
import { Checkbox } from "~/components/ui/Checkbox";
import { IconButton } from "~/components/ui/IconButton";
import { MultiSelect, Popover } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import type { SelectOption } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { formatUsd } from "~/lib/money";
import { cn } from "~/lib/cn";
import type { TermOption } from "~/lib/terms.shared";
import { usePlannerAutosave } from "../lib/use-planner-autosave";
import type { PlannerRow } from "../routes/core.partners.plan";
import {
  PARTNER_PLANNING_LABELS,
  PARTNER_PLANNING_PILL,
  PARTNER_PLANNING_ROW_TINT,
  PARTNER_PLANNING_SORT,
  PARTNER_PLANNING_STATUSES,
  type PartnerPlanningStatus,
} from "../lib/partner-planning";

type DomainOption = { id: string; name: string; hidden: boolean };

type Props = {
  rows: PlannerRow[];
  domains: DomainOption[];
  terms: TermOption[];
  selectedTermId: string | null;
};

type StatusFilterValue = PartnerPlanningStatus | "Unset";
const STATUS_FILTER_VALUES: StatusFilterValue[] = [
  ...PARTNER_PLANNING_STATUSES,
  "Unset",
];

export function PartnerTermPlanner({ rows, domains, terms, selectedTermId }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue[]>([]);
  const [domainFilter, setDomainFilter] = useState<string[]>([]);
  const columnsFetcher = useFetcher();
  const pendingHidden = columnsFetcher.formData?.getAll("hiddenDomainIds") as
    | string[]
    | undefined;
  const hiddenIds = new Set(
    pendingHidden ?? domains.filter((d) => d.hidden).map((d) => d.id),
  );
  const visibleDomains = domains.filter((d) => !hiddenIds.has(d.id));

  function toggleColumn(domainId: string) {
    const next = new Set(hiddenIds);
    if (next.has(domainId)) next.delete(domainId);
    else next.add(domainId);
    const form = new FormData();
    form.set("intent", "set-hidden-domains");
    for (const id of next) form.append("hiddenDomainIds", id);
    columnsFetcher.submit(form, { method: "post" });
    setDomainFilter((f) => f.filter((id) => !next.has(id)));
  }

  const statusOptions: SelectOption<StatusFilterValue>[] = STATUS_FILTER_VALUES.map((s) => ({
    value: s,
    label: s === "Unset" ? "Unset" : PARTNER_PLANNING_LABELS[s],
  }));
  const domainOptions: SelectOption<string>[] = visibleDomains.map((d) => ({
    value: d.id,
    label: d.name,
  }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.title} ${r.partnerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter.length) {
        const key: StatusFilterValue = r.planningStatus ?? "Unset";
        if (!statusFilter.includes(key)) return false;
      }
      if (domainFilter.length) {
        const hasAny = r.domains.some(
          (d) => domainFilter.includes(d.domainId) && d.expectedMembers > 0,
        );
        if (!hasAny) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, domainFilter]);

  // "Later" rows render in a separate group at the bottom. Everything else is
  // sorted by planning intent (continuing → new → maybe), then title.
  const activeRows = useMemo(() => {
    return filtered
      .filter((r) => r.planningStatus !== "Later")
      .sort((a, b) => {
        const as = a.planningStatus
          ? PARTNER_PLANNING_SORT[a.planningStatus]
          : 99;
        const bs = b.planningStatus
          ? PARTNER_PLANNING_SORT[b.planningStatus]
          : 99;
        if (as !== bs) return as - bs;
        return a.title.localeCompare(b.title);
      });
  }, [filtered]);
  const laterRows = useMemo(
    () =>
      filtered
        .filter((r) => r.planningStatus === "Later")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [filtered],
  );

  function sumMembers(rowList: PlannerRow[], domainId: string): number {
    let s = 0;
    for (const r of rowList) {
      const cell = r.domains.find((d) => d.domainId === domainId);
      if (cell) s += cell.expectedMembers;
    }
    return s;
  }

  function sumFee(rowList: PlannerRow[]): number {
    let s = 0;
    for (const r of rowList) if (r.feeCents != null) s += r.feeCents;
    return s;
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start gap-2">
        <TermFilter
          terms={terms}
          selected={selectedTermId ?? ""}
          includeAll={false}
          replace
        />
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects"
          containerClassName="w-full sm:w-64"
        />
        <MultiSelect
          values={statusFilter}
          options={statusOptions}
          onChange={setStatusFilter}
          placeholder="All statuses"
          ariaLabel="Filter by planning status"
          buttonClassName={cn(filterPillClass(), "w-full sm:w-40")}
        />
        <MultiSelect
          values={domainFilter}
          options={domainOptions}
          onChange={setDomainFilter}
          placeholder="All domains"
          ariaLabel="Filter by domain"
          buttonClassName={cn(filterPillClass(), "w-full sm:w-40")}
        />
        <Popover
          align="right"
          ariaLabel="Domain columns"
          trigger={<IconButton label="Choose domain columns" icon={Columns3} className="size-[42px]" />}
        >
          <div className="flex flex-col gap-2 p-1">
            <div className="text-xs font-medium text-muted-foreground">Domain columns</div>
            {domains.map((d) => (
              <Checkbox
                key={d.id}
                tone="os"
                label={d.name}
                checked={!hiddenIds.has(d.id)}
                onChange={() => toggleColumn(d.id)}
              />
            ))}
          </div>
        </Popover>
        <div className="ml-auto self-center text-xs text-muted-foreground">
          {filtered.length} project{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      <PlannerTable
        activeRows={activeRows}
        laterRows={laterRows}
        domains={visibleDomains}
        sumMembers={sumMembers}
        sumFee={sumFee}
      />
    </div>
  );
}

function PlannerTable({
  activeRows,
  laterRows,
  domains,
  sumMembers,
  sumFee,
}: {
  activeRows: PlannerRow[];
  laterRows: PlannerRow[];
  domains: DomainOption[];
  sumMembers: (rows: PlannerRow[], domainId: string) => number;
  sumFee: (rows: PlannerRow[]) => number;
}) {
  const totalRows = [...activeRows, ...laterRows];

  return (
    <div className="overflow-x-auto rounded-lg border border-os-container">
      <table className="w-full text-sm">
        <thead className="bg-os-card text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-32 px-3 py-2">Status</th>
            <th className="min-w-[180px] px-3 py-2">Project</th>
            <th className="min-w-[220px] px-3 py-2">Notes / Description</th>
            <th className="min-w-[180px] px-3 py-2">To-Do</th>
            <th className="w-24 px-3 py-2 text-right">$</th>
            {domains.map((d) => (
              <th key={d.id} className="w-16 px-2 py-2 text-center" title={d.name}>
                {shortDomain(d.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeRows.map((r) => (
            <PlannerRowView key={r.targetTermId} row={r} domains={domains} />
          ))}
          {activeRows.length === 0 && laterRows.length === 0 ? (
            <tr>
              <td
                colSpan={5 + domains.length}
                className="px-3 py-8 text-center text-sm text-muted-foreground"
              >
                No projects target this term yet. Set a target term on an
                application from the Applications board.
              </td>
            </tr>
          ) : null}
          {laterRows.length > 0 ? (
            <>
              <tr>
                <td
                  colSpan={5 + domains.length}
                  className="border-t border-os-container bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Later: deferred to a future term
                </td>
              </tr>
              {laterRows.map((r) => (
                <PlannerRowView key={r.targetTermId} row={r} domains={domains} />
              ))}
            </>
          ) : null}
        </tbody>
        {totalRows.length > 0 ? (
          <tfoot>
            <tr className="border-t-2 border-os-container bg-os-card font-medium">
              <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                Est. Total
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right">
                {sumFee(totalRows) > 0 ? formatUsd(sumFee(totalRows) / 100) : "—"}
              </td>
              {domains.map((d) => {
                const total = sumMembers(totalRows, d.id);
                return (
                  <td key={d.id} className="px-2 py-2 text-center">
                    {total > 0 ? total : ""}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function PlannerRowView({ row, domains }: { row: PlannerRow; domains: DomainOption[] }) {
  const navigate = useNavigate();
  const tint = row.planningStatus ? PARTNER_PLANNING_ROW_TINT[row.planningStatus] : "";

  return (
    <tr className={cn("border-t border-os-container align-top", tint)}>
      <td className="px-3 py-2">
        <StatusChip row={row} />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          className="text-left font-medium hover:underline"
          onClick={() => navigate(`/core/partners/applications/${row.applicationId}`)}
        >
          {row.title}
        </button>
        <div className="text-xs text-muted-foreground">{row.partnerName}</div>
      </td>
      <td className="px-3 py-2">
        <AutoSaveTextCell
          initial={row.plannerNotes ?? ""}
          targetTermId={row.targetTermId}
          field="plannerNotes"
          placeholder="Notes"
        />
      </td>
      <td className="px-3 py-2">
        <AutoSaveTextCell
          initial={row.plannerTodo ?? ""}
          targetTermId={row.targetTermId}
          field="plannerTodo"
          placeholder="To-do"
        />
      </td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">
        {row.feeCents != null ? formatUsd(row.feeCents / 100) : ""}
      </td>
      {domains.map((d) => {
        const cell = row.domains.find((c) => c.domainId === d.id);
        return (
          <td key={d.id} className="px-2 py-2 text-center">
            <MemberCountCell
              label={`${d.name} headcount for ${row.title}`}
              applicationId={row.applicationId}
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

function StatusChip({ row }: { row: PlannerRow }) {
  const toast = useToast();
  const revalidator = useRevalidator();
  const [saving, setSaving] = useState(false);
  const current = row.planningStatus;
  const label = current ? PARTNER_PLANNING_LABELS[current] : "Set status";
  const pill = current
    ? PARTNER_PLANNING_PILL[current]
    : "bg-muted text-muted-foreground";

  async function pick(next: PartnerPlanningStatus | null, close: () => void) {
    close();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/partner-application-target-terms/${row.targetTermId}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planningStatus: next }),
        },
      );
      if (!res.ok) throw new Error("save failed");
      await revalidator.revalidate();
    } catch {
      toast.error("Couldn't save status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      align="left"
      trigger={(open) => (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Planning status for ${row.title}: ${label}`}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
            pill,
          )}
        >
          {label}
          <ChevronDown size={12} />
        </button>
      )}
      panelClassName="min-w-[9rem] rounded-lg border border-os-container bg-os-card p-1 shadow-lg"
    >
      {(close) => (
        <div className="flex flex-col">
          {PARTNER_PLANNING_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-os-hover"
              onClick={() => pick(s, close)}
            >
              <span className={cn("inline-block h-2.5 w-2.5 rounded-full", PARTNER_PLANNING_PILL[s])} />
              {PARTNER_PLANNING_LABELS[s]}
            </button>
          ))}
          {current ? (
            <button
              type="button"
              className="mt-1 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-os-hover"
              onClick={() => pick(null, close)}
            >
              Clear
            </button>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

function AutoSaveTextCell({
  initial,
  targetTermId,
  field,
  placeholder,
}: {
  initial: string;
  targetTermId: string;
  field: "plannerNotes" | "plannerTodo";
  placeholder: string;
}) {
  const toast = useToast();
  const { value, change, flush } = usePlannerAutosave(initial, async (next) => {
    const res = await fetch(
      `/api/partner-application-target-terms/${targetTermId}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next.trim() === "" ? null : next }),
      },
    );
    if (!res.ok) throw new Error("save failed");
  }, () => toast.error("Couldn't save."));

  return (
    <textarea
      className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      rows={2}
      placeholder={placeholder}
      value={value}
      aria-label={placeholder}
      onChange={(e) => change(e.target.value)}
      onBlur={() => void flush()}
    />
  );
}

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

  const { value, change, flush } = usePlannerAutosave(initial, async (next) => {
    let id = rowId.current;
    if (!id) {
      if (next <= 0) return;
      const createRes = await fetch(
        `/api/partner-applications/${applicationId}/domains`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domainId }),
        },
      );
      if (!createRes.ok) throw new Error("create failed");
      const created = (await createRes.json()) as { id: string };
      id = created.id;
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
  }, () => toast.error("Couldn't save headcount."));

  return (
    <input
      type="number"
      min={0}
      className="w-12 bg-transparent text-center text-sm outline-none"
      value={value === 0 ? "" : value}
      placeholder=""
      aria-label={label}
      max={2_147_483_647}
      onChange={(e) => {
        const n = Math.min(2_147_483_647, Math.max(0, Math.floor(Number(e.target.value) || 0)));
        change(n);
      }}
      onBlur={() => void flush()}
    />
  );
}

// Short domain header: "Fullstack Dev" → "Fullstack", "AR/VR" → "AR/VR" —
// keep columns narrow but still legible. `title` on the <th> carries the full
// name on hover.
function shortDomain(name: string): string {
  const trimmed = name.replace(/\s*Dev$/i, "").trim();
  return trimmed.length > 12 ? trimmed.slice(0, 10) + "…" : trimmed;
}
