import { Download } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { FilterField, FilterGroup, FilterPill, FilterToggleRow, FiltersPopover } from "~/components/ui/filter-panel";
import { FILTER_KEYS } from "../routes/filters";
import type { ExpenseStatusValue } from "../lib/status";
import { exportHref } from "./export-link";
import type { CardOption, CategoryOption } from "./types";

const STATUSES: { value: ExpenseStatusValue; label: string }[] = [
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Waiting on approval" },
  { value: "RETURNED", label: "Returned" },
  { value: "APPROVED", label: "Approved" },
  { value: "PAID", label: "Paid" },
];

export function activeFilterCount(params: URLSearchParams): number {
  return FILTER_KEYS.filter((k) => params.get(k)).length;
}

export function toggleListValue(raw: string | null, value: string): string | null {
  const list = (raw ?? "").split(",").filter(Boolean);
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return next.length ? next.join(",") : null;
}

export function AllExpensesFilters({
  params,
  onChange,
  cards,
  categories,
  terms,
}: {
  params: URLSearchParams;
  onChange: (changes: Record<string, string | null>) => void;
  cards: CardOption[];
  categories: CategoryOption[];
  terms: { id: string; code: string }[];
}) {
  const get = (k: string) => params.get(k) ?? "";
  const pick = (k: string, v: string) => onChange({ [k]: get(k) === v ? null : v });
  const statuses = get("status").split(",");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FiltersPopover
        align="left"
        count={activeFilterCount(params)}
        onReset={() => onChange(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}
      >
        <FilterGroup label="Status">
          {STATUSES.map((s) => (
            <FilterPill key={s.value} selected={statuses.includes(s.value)} onClick={() => onChange({ status: toggleListValue(params.get("status"), s.value) })}>
              {s.label}
            </FilterPill>
          ))}
        </FilterGroup>
        {cards.length > 0 && (
          <FilterGroup label="Card">
            {cards.map((c) => (
              <FilterPill key={c.id} selected={get("cardId") === c.id} onClick={() => pick("cardId", c.id)}>
                {c.nickname} ··{c.last4}
              </FilterPill>
            ))}
          </FilterGroup>
        )}
        {categories.length > 0 && (
          <FilterGroup label="Category">
            {categories.map((c) => (
              <FilterPill key={c.id} selected={get("categoryId") === c.id} onClick={() => pick("categoryId", c.id)}>
                {c.label}
              </FilterPill>
            ))}
          </FilterGroup>
        )}
        {terms.length > 0 && (
          <FilterGroup label="Term">
            {terms.map((t) => (
              <FilterPill key={t.id} selected={get("termId") === t.id} onClick={() => pick("termId", t.id)}>
                {t.code}
              </FilterPill>
            ))}
          </FilterGroup>
        )}
        <FilterField label="Purchased">
          <div className="grid grid-cols-2 gap-2">
            <DateField mode="date" ariaLabel="From" value={get("from")} onChange={(v) => onChange({ from: v || null })} placeholder="From" />
            <DateField mode="date" ariaLabel="To" value={get("to")} onChange={(v) => onChange({ to: v || null })} placeholder="To" />
          </div>
        </FilterField>
        <FilterToggleRow label="No receipt" checked={get("noReceipt") === "1"} onChange={(on) => onChange({ noReceipt: on ? "1" : null })} />
        <FilterToggleRow label="Not paid back" checked={get("outstanding") === "1"} onChange={(on) => onChange({ outstanding: on ? "1" : null })} />
      </FiltersPopover>
      <span className="ml-auto flex items-center gap-2">
        <a className={buttonClasses("secondary", "sm")} href={exportHref("csv", "all", params)}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </a>
        <a className={buttonClasses("secondary", "sm")} href={exportHref("pdf", "all", params)}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Receipts PDF
        </a>
      </span>
    </div>
  );
}
