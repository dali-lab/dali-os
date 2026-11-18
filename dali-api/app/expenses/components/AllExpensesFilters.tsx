import { Download } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { Toggle } from "~/components/ui/Toggle";
import { Select } from "~/components/ui/floating";
import { exportHref } from "./export-link";
import type { CardOption, CategoryOption } from "./types";

const ANY = "";
const STATUS_OPTIONS = [
  { value: ANY, label: "Any status" },
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Waiting on staff" },
  { value: "RETURNED", label: "Returned" },
  { value: "APPROVED", label: "Approved or reviewed" },
  { value: "PAID", label: "Paid" },
];

export function AllExpensesFilters({
  params,
  onChange,
  cards,
  categories,
  terms,
}: {
  params: URLSearchParams;
  onChange: (key: string, value: string | null) => void;
  cards: CardOption[];
  categories: CategoryOption[];
  terms: { id: string; code: string }[];
}) {
  const get = (k: string) => params.get(k) ?? ANY;
  const set = (k: string) => (v: string) => onChange(k, v || null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select ariaLabel="Status" value={get("status")} onChange={set("status")} options={STATUS_OPTIONS} />
      <Select ariaLabel="Card" value={get("cardId")} onChange={set("cardId")} options={[{ value: ANY, label: "Any card" }, ...cards.map((c) => ({ value: c.id, label: `${c.nickname} ··${c.last4}` }))]} />
      <Select ariaLabel="Category" value={get("categoryId")} onChange={set("categoryId")} options={[{ value: ANY, label: "Any category" }, ...categories.map((c) => ({ value: c.id, label: c.label }))]} />
      <Select ariaLabel="Term" value={get("termId")} onChange={set("termId")} options={[{ value: ANY, label: "Any term" }, ...terms.map((t) => ({ value: t.id, label: t.code }))]} />
      <DateField mode="date" ariaLabel="From" value={get("from")} onChange={set("from")} placeholder="From" />
      <DateField mode="date" ariaLabel="To" value={get("to")} onChange={set("to")} placeholder="To" />
      <Toggle label="No receipt" checked={params.get("noReceipt") === "1"} onChange={(e) => onChange("noReceipt", e.target.checked ? "1" : null)} />
      <Toggle label="Not paid back" checked={params.get("outstanding") === "1"} onChange={(e) => onChange("outstanding", e.target.checked ? "1" : null)} />
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
