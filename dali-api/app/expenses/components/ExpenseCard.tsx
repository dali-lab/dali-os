import { useState } from "react";
import { AlertTriangle, Check as CheckIcon } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { FormField } from "~/components/ui/FormField";
import { Field } from "~/components/ui/modal-fields";
import { Pill } from "~/components/ui/Pill";
import { Segmented } from "~/components/ui/Segmented";
import { useDialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/floating";
import { formatCents } from "../lib/money";
import {
  OWN,
  buildPatch,
  cardChoice,
  formBlockers,
  initialForm,
  permissionsFor,
  type CardForm,
} from "./card-form";
import { cardLabel, formatDay, statusPill } from "./format";
import { ReceiptPreview } from "./ReceiptPreview";
import type { CardOption, CategoryOption, ExpenseView, ViewerSummary } from "./types";
import type { ExpenseActions } from "./useExpenseActions";

export function ExpenseCard({
  expense,
  viewer,
  cards,
  categories,
  actions,
  onClose,
}: {
  expense: ExpenseView;
  viewer: ViewerSummary;
  cards: CardOption[];
  categories: CategoryOption[];
  actions: ExpenseActions;
  onClose: () => void;
}) {
  const dialog = useDialog();
  const perms = permissionsFor(expense, viewer);
  const [form, setForm] = useState<CardForm>(() => initialForm(expense));
  const [attempted, setAttempted] = useState(false);
  const set = <K extends keyof CardForm>(key: K, value: CardForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const mode = perms.canEdit ? "edit" : "coding";
  const codingEditable = perms.canEdit || perms.canDecide;
  const patch = buildPatch(form, expense, mode);
  const dirty = Object.keys(patch).length > 0;
  const blockers = formBlockers(form, expense);
  const pill = statusPill(expense);
  const busy = actions.busy;

  const cardOptions = cards.filter((c) => !c.archived || cardChoice(c.id) === form.paidWith);
  const choices = [
    ...cardOptions.map((c) => ({ value: cardChoice(c.id), label: cardLabel(c) })),
    { value: OWN, label: "Personal card" },
  ];
  const chosenCard = cards.find((c) => cardChoice(c.id) === form.paidWith);
  const category = categories.find((c) => c.id === form.categoryId);

  const send = (intent: string, extra: Record<string, string> = {}) =>
    actions.submit(intent, { id: expense.id, ...(dirty && codingEditable ? { patch: JSON.stringify(patch) } : {}), ...extra });

  const submit = () => {
    setAttempted(true);
    if (blockers.length === 0) send("submit");
  };

  const returnWithNote = async () => {
    const note = await dialog.prompt({
      title: "Return with a note",
      description: "The note goes to the person who filed this so they know what to fix.",
      label: "Note",
      confirmLabel: "Return",
      validate: (v) => (v.trim() ? null : "Add a note."),
    });
    if (note) send("decide", { decision: "return", note });
  };

  const remove = async () => {
    const yes = await dialog.confirm({
      title: "Delete this draft?",
      description: "Its receipts are deleted too.",
      confirmLabel: "Delete draft",
      tone: "destructive",
    });
    if (yes) actions.submit("delete", { id: expense.id });
  };

  const footerNote = expense.paidWith === "STAFF_CARD"
    ? chosenCard
      ? `Goes to ${chosenCard.ownerName}, who owns this card.`
      : "Goes to the card owner or staff."
    : "Goes to staff for approval.";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-label="Receipts" className="flex flex-col gap-3">
        {expense.noReceipt ? (
          <div className="flex flex-col gap-3 rounded-os-card bg-os-well p-5">
            <Pill tone="warning" size="sm">No receipt</Pill>
            {expense.charge && (
              <div className="flex flex-col gap-0.5">
                <p className="font-mono text-sm text-foreground">{expense.charge.merchant}</p>
                <p className="text-xs text-os-grey">
                  {formatDay(expense.charge.postedAt)} · {formatCents(expense.charge.amountCents)}
                </p>
              </div>
            )}
          </div>
        ) : (
          <ReceiptPreview receipts={expense.receipts} />
        )}
      </section>

      <section aria-label="Details" className="os-form flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={pill.tone} size="sm">{pill.label}</Pill>
          {expense.noReceipt && <Pill tone="warning" size="sm">No receipt</Pill>}
          {!perms.isFiler && <span className="text-xs text-os-grey">Filed by {expense.submitterName}</span>}
        </div>

        {expense.status === "RETURNED" && expense.decisionNote && (
          <p role="status" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-foreground">
            Returned{expense.approverName ? ` by ${expense.approverName}` : ""}: {expense.decisionNote}
          </p>
        )}
        {expense.noReceipt && (
          perms.canEdit ? (
            <FormField label="Why is there no receipt?" multiline rows={2} value={form.reason} onChange={(v) => set("reason", v)} />
          ) : (
            <p className="text-sm text-foreground">
              <span className="text-os-grey">Why no receipt: </span>
              {expense.noReceiptReason}
            </p>
          )
        )}
        {expense.extractionError && !expense.noReceipt && (
          <p className="text-sm text-os-grey">The details couldn't be read from the receipts. Fill them in by hand.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <FormField
            label="Merchant"
            value={form.merchant}
            onChange={(v) => set("merchant", v)}
            disabled={!perms.canEdit}
            invalid={expense.uncertain.includes("merchant") && form.merchant === (expense.merchant ?? "")}
          />
          <FormField
            label="Amount"
            value={form.amount}
            onChange={(v) => set("amount", v)}
            disabled={!perms.canEdit}
            invalid={expense.uncertain.includes("total") && form.amount === initialForm(expense).amount}
          />
        </div>
        <Field label="Date">
          <DateField mode="date" ariaLabel="Date" value={form.date} onChange={(v) => set("date", v)} disabled={!perms.canEdit} />
        </Field>

        {expense.lineItems.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-widest text-os-grey">Items</p>
            <ul className="text-sm text-foreground">
              {expense.lineItems.map((l, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{l.qty && l.qty > 1 ? `${l.qty} × ` : ""}{l.description}</span>
                  {l.amountCents !== null && <span className="tabular-nums">{formatCents(l.amountCents)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <FormField label="Purpose" multiline rows={2} value={form.purpose} onChange={(v) => set("purpose", v)} disabled={!codingEditable} />

        <Field label="Category">
          <Select
            ariaLabel="Category"
            value={form.categoryId}
            onChange={(v) => set("categoryId", v)}
            disabled={!codingEditable}
            placeholder="Pick a category"
            options={categories.filter((c) => !c.archived || c.id === form.categoryId).map((c) => ({ value: c.id, label: c.label }))}
          />
        </Field>
        {category && expense.suggestion?.categoryId === category.id && (
          <p className="-mt-2 text-xs text-os-grey">{expense.suggestion.reason}</p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="os-field-label">Paid with</span>
          {perms.canEdit ? (
            choices.length <= 3 ? (
              <Segmented ariaLabel="Paid with" value={form.paidWith} onChange={(v) => set("paidWith", v)} options={choices} />
            ) : (
              <Select ariaLabel="Paid with" value={form.paidWith} onChange={(v) => set("paidWith", v)} options={choices} placeholder="Choose how it was paid" />
            )
          ) : (
            <p className="text-sm text-foreground">{choices.find((c) => c.value === form.paidWith)?.label ?? expense.cardLabel ?? "Not chosen"}</p>
          )}
        </div>

        {expense.status === "APPROVED" && expense.paidWith === "STAFF_CARD" && (
          <p className="text-sm text-os-grey">
            {expense.charge
              ? `Matched to ${expense.charge.merchant}, ${formatCents(expense.charge.amountCents)} on ${formatDay(expense.charge.postedAt)}.`
              : "Not on the statement yet."}
          </p>
        )}

        {expense.checks.length > 0 && (
          <ul aria-label="Checks" className="flex flex-col gap-1">
            {expense.checks.map((c) => (
              <li key={c.code} className="flex items-start gap-2 text-sm text-foreground">
                {c.level === "ok" ? (
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-os-green" aria-hidden />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-os-amber" aria-hidden />
                )}
                {c.message}
              </li>
            ))}
          </ul>
        )}

        {perms.canEdit && attempted && blockers.length > 0 && (
          <ul role="alert" aria-label="Before you submit" className="flex flex-col gap-1 rounded-lg bg-os-amber/10 px-3 py-2 text-sm text-foreground">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        {actions.error && (
          <p role="alert" className="text-sm text-destructive">
            {actions.error}
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-os-container pt-4">
          {perms.canEdit && <p className="text-xs text-os-grey">{footerNote}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {perms.canDelete && (
              <Button variant="ghost" onClick={remove} disabled={busy} className="mr-auto">
                Delete draft
              </Button>
            )}
            {perms.canEdit && (
              <>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button variant="secondary" disabled={busy || !dirty} onClick={() => send("save")}>Save</Button>
                <Button disabled={busy} onClick={submit}>Submit</Button>
              </>
            )}
            {perms.canWithdraw && (
              <Button variant="secondary" disabled={busy} onClick={() => actions.submit("withdraw", { id: expense.id })}>
                Withdraw
              </Button>
            )}
            {perms.canDecide && (
              <>
                <Button variant="secondary" disabled={busy} onClick={returnWithNote}>Return with note</Button>
                <Button disabled={busy} onClick={() => send("decide", { decision: "approve" })}>Approve</Button>
              </>
            )}
            {perms.canMarkPaid && (
              <Button disabled={busy} onClick={() => actions.submit("mark-paid", { id: expense.id })}>
                {perms.isFiler ? "Got paid" : "Mark paid"}
              </Button>
            )}
            {perms.canUnmatch && (
              <Button variant="ghost" disabled={busy} onClick={() => actions.submit("unmatch-charge", { expenseId: expense.id })}>
                Unmatch
              </Button>
            )}
            {!perms.canEdit && !perms.canDecide && <Button variant="ghost" onClick={onClose}>Close</Button>}
          </div>
        </div>
      </section>
    </div>
  );
}
