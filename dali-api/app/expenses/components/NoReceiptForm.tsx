import { useRef, useState } from "react";
import { Button } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { FormField } from "~/components/ui/FormField";
import { Field } from "~/components/ui/modal-fields";
import { Segmented } from "~/components/ui/Segmented";
import { Toggle } from "~/components/ui/Toggle";
import { Select } from "~/components/ui/floating";
import { centsToDecimalString, formatCents, parseMoneyToCents } from "../lib/money";
import { OWN, cardChoice } from "./card-form";
import { cardLabel, formatDay } from "./format";
import { RECEIPT_ACCEPT } from "./receipt-upload";
import type { CardOption, CategoryOption } from "./types";

export type NoReceiptCharge = {
  id: string;
  cardId: string;
  cardNickname: string;
  cardLast4?: string;
  merchant: string;
  postedAt: string;
  amountCents: number;
};

export function noReceiptFields(
  f: { merchant: string; date: string; amount: string; purpose: string; categoryId: string; paidWith: string; reason: string },
  chargeId?: string,
): Record<string, string> {
  const out: Record<string, string> = {
    merchant: f.merchant.trim(),
    purchasedAt: f.date,
    amount: f.amount.trim(),
    purpose: f.purpose.trim(),
    categoryId: f.categoryId,
    reason: f.reason.trim(),
  };
  if (chargeId) out.chargeId = chargeId;
  else if (f.paidWith === OWN) out.paidWith = "OWN_CARD";
  else if (f.paidWith.startsWith("card:")) Object.assign(out, { paidWith: "STAFF_CARD", cardId: f.paidWith.slice(5) });
  return out;
}

export function noReceiptMissing(f: { merchant: string; date: string; amount: string; reason: string; paidWith: string }, hasCharge: boolean): string | null {
  if (!f.reason.trim()) return "Say why there is no receipt.";
  if (!f.merchant.trim()) return "Add the merchant.";
  if (!f.date) return "Add the purchase date.";
  const cents = parseMoneyToCents(f.amount);
  if (cents === null || cents <= 0) return "Add the amount.";
  if (!hasCharge && !f.paidWith) return "Choose how it was paid.";
  return null;
}

export function NoReceiptForm({
  charge,
  cards,
  categories,
  busy,
  error,
  onSubmit,
  onFiles,
  onCancel,
}: {
  charge?: NoReceiptCharge | null;
  cards: CardOption[];
  categories: CategoryOption[];
  busy: boolean;
  error?: string | null;
  onSubmit: (fields: Record<string, string>) => void;
  onFiles: (files: File[]) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    merchant: charge?.merchant ?? "",
    date: charge?.postedAt ?? "",
    amount: charge ? centsToDecimalString(charge.amountCents) : "",
    purpose: "",
    categoryId: "",
    paidWith: "",
    reason: "",
  });
  const [noReceipt, setNoReceipt] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const missing = noReceiptMissing(form, Boolean(charge));
  const choices = [
    ...cards.filter((c) => !c.archived).map((c) => ({ value: cardChoice(c.id), label: cardLabel(c) })),
    { value: OWN, label: "Personal card" },
  ];

  return (
    <div className="os-form flex flex-col gap-4">
      {charge && (
        <div className="flex flex-col gap-0.5 rounded-os-card bg-os-well p-4">
          <p className="font-mono text-sm text-foreground">{charge.merchant}</p>
          <p className="text-xs text-os-grey">
            {formatDay(charge.postedAt)} · {formatCents(charge.amountCents)} · {charge.cardNickname}
            {charge.cardLast4 ? ` ··${charge.cardLast4}` : ""}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-os-card border border-dashed border-os-container-hi p-4 opacity-70">
        <p className="text-sm font-medium text-foreground">Found it after all?</p>
        <p className="text-xs text-os-grey">Add the receipt and the details fill in automatically.</p>
        <input
          ref={picker}
          type="file"
          multiple
          accept={RECEIPT_ACCEPT}
          className="sr-only"
          aria-label="Choose receipt files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
        <div>
          <Button variant="secondary" size="sm" onClick={() => picker.current?.click()}>
            Choose files
          </Button>
        </div>
      </div>

      <Toggle checked={noReceipt} onChange={(e) => setNoReceipt(e.target.checked)} label="No receipt" />

      {noReceipt && (
        <>
          <FormField label="Why is there no receipt?" multiline rows={2} value={form.reason} onChange={(v) => set("reason", v)} hint="For example: paper receipt lost, paid at the Co-op register." />
          {!charge && (
            <>
              <FormField label="Merchant" value={form.merchant} onChange={(v) => set("merchant", v)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date">
                  <DateField mode="date" ariaLabel="Date" value={form.date} onChange={(v) => set("date", v)} />
                </Field>
                <FormField label="Amount" value={form.amount} onChange={(v) => set("amount", v)} />
              </div>
            </>
          )}
          <FormField label="Purpose" multiline rows={2} value={form.purpose} onChange={(v) => set("purpose", v)} />
          <Field label="Category">
            <Select ariaLabel="Category" value={form.categoryId} onChange={(v) => set("categoryId", v)} placeholder="Pick a category" options={categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.label }))} />
          </Field>
          {!charge && (
            <div className="flex flex-col gap-1.5">
              <span className="os-field-label">Paid with</span>
              {choices.length <= 3 ? (
                <Segmented ariaLabel="Paid with" value={form.paidWith} onChange={(v) => set("paidWith", v)} options={choices} />
              ) : (
                <Select ariaLabel="Paid with" value={form.paidWith} onChange={(v) => set("paidWith", v)} options={choices} placeholder="Choose how it was paid" />
              )}
            </div>
          )}
        </>
      )}

      {attempted && missing && (
        <p role="alert" className="text-sm text-destructive">
          {missing}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={busy || !noReceipt}
          onClick={() => {
            setAttempted(true);
            if (!missing) onSubmit(noReceiptFields(form, charge?.id));
          }}
        >
          Submit without receipt
        </Button>
      </div>
    </div>
  );
}
