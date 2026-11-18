import { useState } from "react";
import { Modal } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { Pill, type PillTone } from "~/components/ui/Pill";
import { Segmented } from "~/components/ui/Segmented";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { formatCents } from "../lib/money";
import { CardFormModal, CategoryFormModal } from "./CardForms";
import { cardLabel, formatDay } from "./format";
import { NoReceiptForm } from "./NoReceiptForm";
import { StatementUpload } from "./StatementUpload";
import type { CardOption, CategoryOption, ChargeRow, ExpenseRow, GroupRow, ImportSummaryView, PersonRow, ViewerSummary } from "./types";
import { useExpenseActions } from "./useExpenseActions";

export type CardsTabData = {
  cards: CardOption[];
  selectedCardId: string | null;
  chargeFilter: string;
  charges: ChargeRow[];
  candidates: ExpenseRow[];
  members: PersonRow[];
  staff: PersonRow[];
  groups: GroupRow[];
};

export const CHARGE_PILL: Record<ChargeRow["state"], { label: string; tone: PillTone }> = {
  needs_receipt: { label: "Needs a receipt", tone: "warning" },
  matched: { label: "Matched", tone: "success" },
  refund: { label: "Refund", tone: "neutral" },
};

export function CardsTab({
  viewer,
  categories,
  tab,
  fileableCards,
  params,
  patchParams,
  onOpenExpense,
}: {
  viewer: ViewerSummary;
  categories: CategoryOption[];
  tab: CardsTabData;
  fileableCards: CardOption[];
  params: URLSearchParams;
  patchParams: (changes: Record<string, string | null>) => void;
  onOpenExpense: (id: string) => void;
}) {
  const { panel } = useOsChrome();
  const dialog = useDialog();
  const toast = useToast();
  const [cardModal, setCardModal] = useState<{ card: CardOption | null } | null>(null);
  const [categoryModal, setCategoryModal] = useState<{ category: CategoryOption | null } | null>(null);
  const [filing, setFiling] = useState<ChargeRow | null>(null);
  const [summary, setSummary] = useState<ImportSummaryView | null>(null);
  const [lastArchive, setLastArchive] = useState<string | null>(null);

  const actions = useExpenseActions(async (intent, result) => {
    if (result.ok) {
      if (intent === "card-save") setCardModal(null);
      if (intent === "category-save") setCategoryModal(null);
      if (intent === "import-statement" && result.summary) setSummary(result.summary);
      if (intent === "create-no-receipt" && result.expenseId) {
        setFiling(null);
        onOpenExpense(result.expenseId);
        return;
      }
      if (result.message) toast.success(result.message);
      return;
    }
    if (intent === "card-archive" && result.needsConfirm && lastArchive) {
      const yes = await dialog.confirm({
        title: "Archive this card?",
        description: `${result.needsConfirm.submittedCount} expense${result.needsConfirm.submittedCount === 1 ? " is" : "s are"} waiting on review. They will go to staff instead of the card owner.`,
        confirmLabel: "Archive card",
        tone: "destructive",
      });
      if (yes) actions.submit("card-archive", { id: lastArchive, confirm: "1" });
    }
  });

  const selected = tab.cards.find((c) => c.id === tab.selectedCardId) ?? null;
  const canFileOnSelected = Boolean(selected && fileableCards.some((c) => c.id === selected.id));
  const inCardModal = actions.pendingIntent === "card-save" || actions.error;
  const formError = actions.error;

  const archive = (id: string) => {
    setLastArchive(id);
    actions.submit("card-archive", { id });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {tab.cards.length > 0 ? (
          <Select
            ariaLabel="Card"
            value={tab.selectedCardId ?? ""}
            onChange={(v) => patchParams({ card: v, charges: null })}
            options={tab.cards.map((c) => ({ value: c.id, label: `${cardLabel(c)}${c.archived ? " (archived)" : ""}` }))}
          />
        ) : (
          <p className="text-sm text-os-grey">No cards yet.</p>
        )}
        {selected && <span className="text-sm text-os-grey">Owner: {selected.ownerName}</span>}
        {viewer.isCore && (
          <span className="ml-auto flex gap-2">
            {selected && !selected.archived && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setCardModal({ card: selected })}>Edit card</Button>
                <Button variant="ghost" size="sm" onClick={() => archive(selected.id)}>Archive card</Button>
              </>
            )}
            <Button size="sm" onClick={() => setCardModal({ card: null })}>Add card</Button>
          </span>
        )}
      </div>

      {selected && (
        <StatementUpload
          cardId={selected.id}
          busy={actions.pendingIntent === "import-statement"}
          error={actions.error && !cardModal && !categoryModal ? actions.error : null}
          summary={summary}
          onImport={(fields) => {
            setSummary(null);
            actions.submit("import-statement", fields);
          }}
        />
      )}

      {selected && (
        <section className={cn(panel, "flex flex-col gap-2 p-2")} aria-label="Charges">
          <div className="flex items-center justify-between px-3 pt-2">
            <h2 className="text-sm font-semibold text-foreground">Charges</h2>
            <Segmented
              ariaLabel="Filter charges"
              value={tab.chargeFilter}
              onChange={(v) => patchParams({ charges: v === "all" ? null : v })}
              options={[
                { value: "all", label: "All" },
                { value: "needs", label: "Needs a receipt" },
                { value: "matched", label: "Matched" },
              ]}
            />
          </div>
          {tab.charges.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-os-grey">No charges yet. Upload a statement to see them.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-os-container">
              {tab.charges.map((c) => (
                <ChargeItem
                  key={c.id}
                  charge={c}
                  candidates={tab.candidates}
                  canFile={canFileOnSelected}
                  busy={actions.busy}
                  onAsk={() => actions.submit("request-receipt", { chargeId: c.id })}
                  onFile={() => setFiling(c)}
                  onMatch={(expenseId) => actions.submit("match-charge", { expenseId, chargeId: c.id })}
                  onUnmatch={() => c.expenseId && actions.submit("unmatch-charge", { expenseId: c.expenseId })}
                  onOpen={() => c.expenseId && onOpenExpense(c.expenseId)}
                />
              ))}
            </ul>
          )}
          {!cardModal && !categoryModal && actions.error && (
            <p role="alert" className="px-3 pb-2 text-sm text-destructive">
              {actions.error}
            </p>
          )}
        </section>
      )}

      {viewer.isCore && (
        <section className={cn(panel, "flex flex-col gap-2 p-4")} aria-label="Categories">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Categories</h2>
            <Button size="sm" variant="secondary" onClick={() => setCategoryModal({ category: null })}>Add category</Button>
          </div>
          <ul className="flex flex-col divide-y divide-os-container">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">{c.label}</span>
                <span className="font-mono text-xs text-os-grey">{c.chartString ?? ""}</span>
                {c.archived ? (
                  <Pill size="xs">Archived</Pill>
                ) : (
                  <>
                    <Button size="xs" variant="ghost" onClick={() => setCategoryModal({ category: c })}>Edit</Button>
                    <Button size="xs" variant="ghost" onClick={() => actions.submit("category-archive", { id: c.id })}>Archive</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {cardModal && (
        <CardFormModal
          key={cardModal.card?.id ?? "new"}
          open
          card={cardModal.card}
          staff={tab.staff}
          members={tab.members}
          groups={tab.groups}
          categories={categories}
          busy={actions.busy}
          error={inCardModal ? formError : null}
          onClose={() => setCardModal(null)}
          onSave={(fields) => actions.submit("card-save", fields)}
        />
      )}
      {categoryModal && (
        <CategoryFormModal
          key={categoryModal.category?.id ?? "new"}
          open
          category={categoryModal.category}
          busy={actions.busy}
          error={formError}
          onClose={() => setCategoryModal(null)}
          onSave={(fields) => actions.submit("category-save", fields)}
        />
      )}
      {filing && selected && (
        <Modal open onClose={() => setFiling(null)} labelledBy="file-no-receipt-title" containerClassName={modalCardClass("max-w-xl")}>
          <h2 id="file-no-receipt-title" className="mb-4 text-lg font-semibold text-foreground">
            File without receipt
          </h2>
          <NoReceiptForm
            charge={{ id: filing.id, cardId: selected.id, cardNickname: selected.nickname, cardLast4: selected.last4, merchant: filing.merchant, postedAt: filing.postedAt, amountCents: filing.amountCents }}
            cards={fileableCards}
            categories={categories}
            busy={actions.busy}
            error={formError}
            onCancel={() => setFiling(null)}
            onFiles={() => setFiling(null)}
            onSubmit={(fields) => actions.submit("create-no-receipt", fields)}
          />
        </Modal>
      )}
    </div>
  );
}

function ChargeItem({
  charge,
  candidates,
  canFile,
  busy,
  onAsk,
  onFile,
  onMatch,
  onUnmatch,
  onOpen,
}: {
  charge: ChargeRow;
  candidates: ExpenseRow[];
  canFile: boolean;
  busy: boolean;
  onAsk: () => void;
  onFile: () => void;
  onMatch: (expenseId: string) => void;
  onUnmatch: () => void;
  onOpen: () => void;
}) {
  const pill = CHARGE_PILL[charge.state];
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-sm text-foreground">{charge.merchant}</span>
        <span className="truncate text-xs text-os-grey">
          {formatDay(charge.postedAt)}
          {charge.filedBy ? ` · Filed by ${charge.filedBy}` : ""}
        </span>
      </span>
      {charge.state === "needs_receipt" && (
        <span className="flex items-center gap-2">
          <Button size="xs" variant="secondary" disabled={busy} onClick={onAsk}>Ask card holders</Button>
          {canFile && <Button size="xs" variant="ghost" onClick={onFile}>File without receipt</Button>}
          {candidates.length > 0 && (
            <Select
              ariaLabel={`Match ${charge.merchant} to an expense`}
              value=""
              placeholder="Match to expense"
              onChange={(id) => id && onMatch(id)}
              options={candidates.map((e) => ({
                value: e.id,
                label: `${e.merchant ?? "Expense"} · ${e.totalCents === null ? "" : formatCents(e.totalCents)}`,
              }))}
            />
          )}
        </span>
      )}
      {charge.state === "matched" && (
        <span className="flex items-center gap-2">
          <Button size="xs" variant="ghost" onClick={onOpen}>Open</Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={onUnmatch}>Unmatch</Button>
        </span>
      )}
      <Pill tone={pill.tone} size="sm">{pill.label}</Pill>
      <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">{formatCents(charge.amountCents)}</span>
    </li>
  );
}
