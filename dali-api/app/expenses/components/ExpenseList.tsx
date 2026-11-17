import { FileText, Receipt } from "lucide-react";
import { Pill } from "~/components/ui/Pill";
import { cn } from "~/lib/cn";
import { formatCents } from "../lib/money";
import { formatDay, statusPill } from "./format";
import type { ExpenseRow } from "./types";

export function ExpenseList({
  rows,
  onOpen,
  selectedId,
  showFiler = false,
  empty,
}: {
  rows: ExpenseRow[];
  onOpen: (id: string) => void;
  selectedId?: string | null;
  showFiler?: boolean;
  empty: string;
}) {
  if (rows.length === 0) return <p className="px-2 py-8 text-center text-sm text-os-grey">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-os-container">
      {rows.map((r) => {
        const pill = statusPill(r);
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              aria-current={selectedId === r.id}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-os-well",
                selectedId === r.id && "bg-os-well",
              )}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-os-well text-os-grey">
                {r.noReceipt ? <FileText className="h-5 w-5" aria-hidden /> : <Receipt className="h-5 w-5" aria-hidden />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{r.merchant ?? "Untitled expense"}</span>
                <span className="truncate text-xs text-os-grey">
                  {[r.purpose, showFiler ? r.submitterName : null, formatDay(r.purchasedAt)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="hidden w-32 shrink-0 truncate text-xs text-os-grey sm:block">{r.categoryLabel ?? "No category"}</span>
              <span className="hidden w-36 shrink-0 truncate text-xs text-os-grey md:block">{r.cardLabel ?? (r.paidWith === "OWN_CARD" ? "Personal card" : "")}</span>
              {r.noReceipt && <Pill tone="warning" size="xs">No receipt</Pill>}
              <Pill tone={pill.tone} size="sm">{pill.label}</Pill>
              <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
                {r.totalCents === null ? "" : formatCents(r.totalCents)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
