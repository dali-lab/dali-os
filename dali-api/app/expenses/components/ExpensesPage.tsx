import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Modal } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { IconButton } from "~/components/ui/IconButton";
import { Segmented } from "~/components/ui/Segmented";
import { SegmentedTabButtons, type SegmentedTab } from "~/components/ui/SegmentedTabs";
import { useToast } from "~/components/ui/toast";
import { X } from "lucide-react";
import { cn } from "~/lib/cn";
import type { ExpensesLoaderData } from "../routes/expenses";
import { AllExpensesFilters } from "./AllExpensesFilters";
import { CardsTab } from "./CardsTab";
import { DropZone } from "./DropZone";
import { ExpenseCard } from "./ExpenseCard";
import { ExpenseList } from "./ExpenseList";
import { NoReceiptForm, type NoReceiptCharge } from "./NoReceiptForm";
import { formatCents } from "../lib/money";
import { formatDay } from "./format";
import { TAB_LABELS, expenseStats, filterRows, tabHref, type PaidFilter } from "./page-model";
import { useExpenseActions } from "./useExpenseActions";
import { useReceiptIntake } from "./useReceiptIntake";


export function ExpensesPage({ data }: { data: ExpensesLoaderData }) {
  const { pageTitle, panel } = useOsChrome();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [noReceiptOpen, setNoReceiptOpen] = useState(false);
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [createError, setCreateError] = useState<string | null>(null);
  const submitAfterCreate = useRef(false);
  const intakeRef = useRef<{ finish: () => void }>({ finish: () => {} });

  const patchParams = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { preventScrollReset: true },
    );

  const actions = useExpenseActions((intent, result) => {
    if (intent === "create" || intent === "create-no-receipt") intakeRef.current.finish();
    if (!result.ok) {
      if (intent === "create" || intent === "create-no-receipt") setCreateError(result.error);
      return;
    }
    setCreateError(null);
    if (intent === "create-no-receipt" && submitAfterCreate.current && result.expenseId) {
      submitAfterCreate.current = false;
      setNoReceiptOpen(false);
      patchParams({ expense: result.expenseId, charge: null });
      actions.submit("submit", { id: result.expenseId });
      return;
    }
    if ((intent === "create" || intent === "create-no-receipt") && result.expenseId) {
      setNoReceiptOpen(false);
      patchParams({ expense: result.expenseId, charge: null });
      return;
    }
    if (intent === "delete") patchParams({ expense: null });
    if (result.message) toast.success(result.message);
  });

  const intake = useReceiptIntake(actions, { cardId: data.charge?.cardId });
  intakeRef.current = intake;

  const tabs: SegmentedTab[] = (Object.keys(TAB_LABELS) as (keyof typeof TAB_LABELS)[])
    .filter((t) => data.tabs[t])
    .map((t) => ({ label: TAB_LABELS[t], href: tabHref(t), active: data.tab === t }));

  const open = (id: string) => patchParams({ expense: id });
  const close = () => patchParams({ expense: null });
  const inline = data.tab === "approvals";
  const modalOpen = Boolean(data.expense) && !inline;

  const card = data.expense && (
    <ExpenseCard
      key={`${data.expense.id}:${data.expense.status}`}
      expense={data.expense}
      viewer={data.viewer}
      cards={data.fileableCards.length ? data.fileableCards : []}
      categories={data.categories}
      actions={actions}
      onClose={close}
    />
  );

  const noReceiptCharge: NoReceiptCharge | null = data.charge;
  const stats = expenseStats(data.rows);

  useEffect(() => {
    if (!noReceiptOpen) submitAfterCreate.current = false;
  }, [noReceiptOpen]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className={pageTitle}>Expenses</h1>
        <p className="text-sm text-os-grey">Drop a receipt and the details fill in automatically.</p>
      </header>

      {tabs.length > 1 && <SegmentedTabButtons items={tabs} label="Expenses sections" />}

      {data.tab === "yours" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Waiting on staff" value={String(stats.waiting)} />
            <Stat label="Owed to you" value={formatCents(stats.owedCents)} />
          </div>
          {data.charge && (
            <div className={cn(panel, "flex flex-col gap-1 p-4")}>
              <p className="text-sm font-semibold text-foreground">Needs a receipt</p>
              <p className="text-sm text-os-grey">
                <span className="font-mono text-foreground">{data.charge.merchant}</span> · {formatCents(data.charge.amountCents)} on{" "}
                {formatDay(data.charge.postedAt)} · {data.charge.cardNickname} ··{data.charge.cardLast4}
              </p>
            </div>
          )}
          {intake.busy ? (
            <ReadingCard count={intake.count} />
          ) : (
            <DropZone
              onFiles={intake.start}
              onNoReceipt={() => setNoReceiptOpen(true)}
              disabled={actions.busy}
              error={intake.error ?? createError}
            />
          )}
          <section className={cn(panel, "flex flex-col gap-2 p-2")}>
            <div className="flex items-center justify-between px-3 pt-2">
              <h2 className="text-sm font-semibold text-foreground">Recent</h2>
              <Segmented
                ariaLabel="Filter by payment"
                value={paidFilter}
                onChange={setPaidFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "STAFF_CARD", label: "Staff card" },
                  { value: "OWN_CARD", label: "Personal card" },
                ]}
              />
            </div>
            <ExpenseList rows={filterRows(data.rows, paidFilter)} onOpen={open} empty="Nothing here yet. Drop a receipt to start." />
          </section>
        </>
      )}

      {data.tab === "approvals" && (
        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section className={cn(panel, "p-2")} aria-label="Waiting on approval">
            <ExpenseList rows={data.rows} onOpen={open} selectedId={data.expense?.id} showFiler empty="Nothing is waiting on you." />
          </section>
          <section className={cn(panel, "p-5")}>{card ?? <p className="text-sm text-os-grey">Pick an expense to review.</p>}</section>
        </div>
      )}

      {data.tab === "all" && (
        <>
          <AllExpensesFilters
            params={params}
            onChange={(k, v) => patchParams({ [k]: v, expense: null })}
            cards={data.allCards}
            categories={data.categories}
            terms={data.terms}
          />
          <section className={cn(panel, "p-2")}>
            <ExpenseList rows={data.rows} onOpen={open} showFiler empty="No expenses match." />
          </section>
        </>
      )}

      {data.tab === "cards" && data.cardsTab && (
        <CardsTab
          viewer={data.viewer}
          categories={data.categories}
          tab={data.cardsTab}
          fileableCards={data.fileableCards}
          params={params}
          patchParams={patchParams}
          onOpenExpense={(id) => patchParams({ tab: "yours", expense: id })}
        />
      )}

      <Modal open={modalOpen} onClose={close} labelledBy="expense-title" containerClassName={modalCardClass("max-w-5xl")}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id="expense-title" className="text-lg font-semibold text-foreground">
            {data.expense?.merchant ?? "Expense"}
          </h2>
          <IconButton label="Close" icon={X} onClick={close} />
        </div>
        {modalOpen && card}
      </Modal>

      <Modal open={noReceiptOpen} onClose={() => setNoReceiptOpen(false)} labelledBy="no-receipt-title" containerClassName={modalCardClass("max-w-xl")}>
        <h2 id="no-receipt-title" className="mb-4 text-lg font-semibold text-foreground">
          No receipt
        </h2>
        <NoReceiptForm
          charge={noReceiptCharge}
          cards={data.fileableCards}
          categories={data.categories}
          busy={actions.busy}
          error={createError}
          onCancel={() => setNoReceiptOpen(false)}
          onFiles={(files) => {
            setNoReceiptOpen(false);
            void intake.start(files);
          }}
          onSubmit={(fields) => {
            submitAfterCreate.current = true;
            setCreateError(null);
            actions.submit("create-no-receipt", fields);
          }}
        />
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { card } = useOsChrome();
  return (
    <div className={cn(card, "flex flex-col gap-1 p-4")}>
      <span className="text-xs text-os-grey">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function ReadingCard({ count }: { count: number }) {
  return (
    <div role="status" aria-live="polite" className="flex animate-pulse flex-col gap-3 rounded-os-card bg-os-card p-6">
      <p className="text-sm font-medium text-foreground">Reading {count} {count === 1 ? "receipt" : "receipts"}</p>
      <div className="h-4 w-1/2 rounded bg-os-container" />
      <div className="h-4 w-2/3 rounded bg-os-container" />
      <div className="h-4 w-1/3 rounded bg-os-container" />
    </div>
  );
}
