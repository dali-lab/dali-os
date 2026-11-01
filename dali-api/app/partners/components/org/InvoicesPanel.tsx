// Manual invoice tracking for one partner org — mounted on the org page's
// Finance tab (core.partners.orgs.$orgId.tsx). Posts intents "invoice-save"
// (create) and "invoice-status" (status change) to that route's own action,
// which calls upsertInvoice / setInvoiceStatus (app/partners/lib/
// partner-finance.server.ts). Submits straight to the current route — no
// cross-route redirect to work around (unlike the application modal's
// postPartnerApplicationIntent helper), so this just uses <Form>.

import { useState } from "react";
import { Form } from "react-router";
import { Plus } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { formatUsd } from "~/lib/money";
import type { PartnerInvoiceStatus } from "~/generated/prisma/enums";

const STATUS_OPTIONS: { value: PartnerInvoiceStatus; label: string }[] = [
  { value: "Draft", label: "Draft" },
  { value: "Issued", label: "Issued" },
  { value: "Paid", label: "Paid" },
  { value: "Void", label: "Void" },
];

const STATUS_DOT: Record<PartnerInvoiceStatus, string> = {
  Draft: "bg-os-muted",
  Issued: "bg-os-accent",
  Paid: "bg-os-green",
  Void: "bg-os-red",
};

export interface InvoiceRow {
  id: string;
  amountCents: number;
  status: PartnerInvoiceStatus;
  issuedAt: string | Date | null;
  dueAt: string | Date | null;
  paidAt: string | Date | null;
  reference: string | null;
  note: string | null;
}

function dateStr(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

export function InvoicesPanel({
  orgId: _orgId,
  invoices,
  canEdit,
}: {
  orgId: string;
  invoices: InvoiceRow[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const os = useOsChrome();

  return (
    <section className={os.sectionShell}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={os.sectionTitle}>Invoices</h2>
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)} className={os.quietBtn}>
            <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
            Add invoice
          </button>
        )}
      </div>

      <div className="rounded-os-card bg-os-card px-5">
        {adding && canEdit && (
          <Form
            method="post"
            onSubmit={() => setAdding(false)}
            className={cn(os.formClass, "flex flex-col gap-3 border-b border-os-container py-4")}
          >
            <input type="hidden" name="intent" value="invoice-save" />
            <div className="grid grid-cols-2 gap-3">
              <label className={os.fieldLabel}>
                <span>Amount *</span>
                <input
                  type="number"
                  name="amount"
                  min="0"
                  step="0.01"
                  required
                  placeholder="0.00"
                  className="w-full"
                />
              </label>
              <label className={os.fieldLabel}>
                <span>Reference</span>
                <input name="reference" type="text" placeholder="INV-001" className="w-full" />
              </label>
              <label className={os.fieldLabel}>
                <span>Issued</span>
                <DateField mode="date" name="issuedAt" ariaLabel="Issued date" />
              </label>
              <label className={os.fieldLabel}>
                <span>Due</span>
                <DateField mode="date" name="dueAt" ariaLabel="Due date" />
              </label>
            </div>
            <label className={os.fieldLabel}>
              <span>Note</span>
              <textarea name="note" rows={2} placeholder="Internal note…" className="w-full resize-none" />
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm">
                Save invoice
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </Form>
        )}

        {invoices.length === 0 ? (
          <p className="py-6 text-sm text-os-grey">No invoices yet.</p>
        ) : (
          <ul>
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
              >
                <span className="text-sm font-medium text-foreground">
                  {formatUsd(inv.amountCents / 100)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-os-well py-0.5 pl-2.5 pr-1.5 text-xs text-foreground">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[inv.status])}
                    aria-hidden
                  />
                  {canEdit ? (
                    <Form method="post" className="inline-flex">
                      <input type="hidden" name="intent" value="invoice-status" />
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <Select
                        name="status"
                        defaultValue={inv.status}
                        ariaLabel="Invoice status"
                        options={STATUS_OPTIONS}
                        onChange={(value) => {
                          const fd = new FormData();
                          fd.set("intent", "invoice-status");
                          fd.set("invoiceId", inv.id);
                          fd.set("status", value);
                          fetch(window.location.pathname, {
                            method: "POST",
                            credentials: "include",
                            body: fd,
                          }).then(() => window.location.reload());
                        }}
                        buttonClassName="inline-flex items-center gap-1 text-xs text-foreground"
                      />
                    </Form>
                  ) : (
                    <span className="pr-1">{inv.status}</span>
                  )}
                </span>
                {inv.reference && <span className="text-xs text-os-grey">{inv.reference}</span>}
                {inv.note && <span className="text-xs italic text-os-grey">{inv.note}</span>}
                <span className="ml-auto text-xs text-os-grey">
                  {inv.dueAt
                    ? `Due ${dateStr(inv.dueAt)}`
                    : inv.issuedAt
                      ? `Issued ${dateStr(inv.issuedAt)}`
                      : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
