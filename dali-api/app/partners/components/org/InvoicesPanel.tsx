// Manual invoice tracking for one partner org — mounted on the org page's
// Finance tab (core.partners.orgs.$orgId.tsx). Posts intents "invoice-save"
// (create) and "invoice-status" (status change) to that route's own action,
// which calls upsertInvoice / setInvoiceStatus (app/partners/lib/
// partner-finance.server.ts). Submits straight to the current route — no
// cross-route redirect to work around (unlike the application modal's
// postPartnerApplicationIntent helper), so this just uses <Form>.

import { useState } from "react";
import { Form } from "react-router";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { formatUsd } from "~/lib/money";
import type { PartnerInvoiceStatus } from "~/generated/prisma/enums";

const STATUS_OPTIONS: { value: PartnerInvoiceStatus; label: string }[] = [
  { value: "Draft", label: "Draft" },
  { value: "Issued", label: "Issued" },
  { value: "Paid", label: "Paid" },
  { value: "Void", label: "Void" },
];

const STATUS_PILL: Record<PartnerInvoiceStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  Issued: "bg-accent-coral/15 text-accent-coral",
  Paid: "bg-accent-teal/15 text-accent-teal",
  Void: "bg-destructive/10 text-destructive",
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

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-semibold text-foreground">Invoices</h2>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            + Add invoice
          </button>
        )}
      </div>

      {adding && canEdit && (
        <Form
          method="post"
          onSubmit={() => setAdding(false)}
          className="flex flex-col gap-2 p-3 bg-muted/30 rounded-md border border-border"
        >
          <input type="hidden" name="intent" value="invoice-save" />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground font-medium">Amount *</span>
              <input
                type="number"
                name="amount"
                min="0"
                step="0.01"
                required
                placeholder="0.00"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground font-medium">Reference</span>
              <input
                name="reference"
                placeholder="INV-001"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground font-medium">Issued</span>
              <DateField mode="date" name="issuedAt" ariaLabel="Issued date" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground font-medium">Due</span>
              <DateField mode="date" name="dueAt" ariaLabel="Due date" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Note</span>
            <textarea
              name="note"
              rows={2}
              placeholder="Internal note…"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-none"
            />
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
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {invoices.map((inv) => (
            <li key={inv.id} className="py-2.5 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-foreground">
                {formatUsd(inv.amountCents / 100)}
              </span>
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
                      fetch(window.location.pathname, { method: "POST", credentials: "include", body: fd }).then(
                        () => window.location.reload(),
                      );
                    }}
                    buttonClassName={`text-xs rounded-full px-2 py-0.5 border border-transparent inline-flex items-center gap-1 ${STATUS_PILL[inv.status]}`}
                  />
                </Form>
              ) : (
                <span className={`text-xs rounded-full px-2 py-0.5 ${STATUS_PILL[inv.status]}`}>
                  {inv.status}
                </span>
              )}
              {inv.reference && <span className="text-xs text-muted-foreground">{inv.reference}</span>}
              {inv.note && <span className="text-xs text-muted-foreground italic">{inv.note}</span>}
              <span className="text-xs text-muted-foreground ml-auto">
                {inv.dueAt ? `Due ${dateStr(inv.dueAt)}` : inv.issuedAt ? `Issued ${dateStr(inv.issuedAt)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
