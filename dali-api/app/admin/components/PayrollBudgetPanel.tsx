import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Trash2, StickyNote } from "lucide-react";
import { Card } from "~/components/ui/Card";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatUsd } from "~/lib/money";
import { cn } from "~/lib/cn";
import { PROJECT_TYPES } from "~/admin/lib/budget.shared";
import { SelectMenu } from "~/components/ui/SelectMenu";
import type {
  BudgetData,
  BudgetGroup,
  BudgetRow,
} from "~/admin/lib/budget.shared";
import type { BudgetLoaderData } from "~/admin/routes/admin.payroll.budget";

// Budget tab. Data is fetched lazily on first activation via a GET fetcher to
// /admin/payroll/budget; mutations post back to the same route through
// per-row hidden-`intent` fetcher Forms (the repo's inline-edit pattern).

const TABLE_WRAP = "bg-card border border-border rounded-lg overflow-x-auto";
const TH = "text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap";
const TH_NUM = "text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap";
const TD = "px-3 py-2 text-muted-foreground";
const TD_NUM = "px-3 py-2 text-right text-muted-foreground tabular-nums";

const BUDGET_ROUTE = "/admin/payroll/budget";

export function PayrollBudgetPanel({ term }: { term: string }) {
  const fetcher = useFetcher<BudgetLoaderData>();

  // Lazy-load on first mount / when the term changes.
  useEffect(() => {
    fetcher.load(`${BUDGET_ROUTE}?term=${encodeURIComponent(term)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  if (fetcher.state === "loading" && !fetcher.data) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">Loading budget…</Card>;
  }
  if (!fetcher.data) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">Loading budget…</Card>;
  }
  if (!fetcher.data.ok) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        {fetcher.data.error}
      </Card>
    );
  }

  const { budget, termId } = fetcher.data;
  return <BudgetTable budget={budget} termId={termId} />;
}

function BudgetTable({ budget, termId }: { budget: BudgetData; termId: string }) {
  const anyPateo = budget.groups.some((g) => g.rows.some((r) => r.isPateo));

  if (budget.groups.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        No budget lines for this term yet. Revenue and expense appear here once
        timesheets are uploaded or revenue is entered.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className={TABLE_WRAP}>
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={TH}>Project</th>
              <th className={TH}>Chart String</th>
              <th className={TH}>Type</th>
              <th className={TH_NUM}>Revenue</th>
              <th className={TH_NUM}>Adj. Revenue</th>
              <th className={TH_NUM}>Expense</th>
              <th className={TH_NUM}>Net</th>
              <th className={TH}>Notes</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {budget.groups.map((g) => (
              <GroupRows key={g.projectId ?? "__none__"} group={g} termId={termId} />
            ))}
            <tr className="border-t-2 border-foreground font-bold text-foreground">
              <td className="px-3 py-2" colSpan={3}>
                Grand total
              </td>
              <td className={cn(TD_NUM, "text-foreground font-bold")}>
                {formatUsd(budget.grandTotalRevenue)}
              </td>
              <td className={cn(TD_NUM, "text-foreground font-bold")}>
                {formatUsd(budget.grandTotalAdjustedRevenue)}
              </td>
              <td className={cn(TD_NUM, "text-foreground font-bold")}>
                {formatUsd(budget.grandTotalExpense)}
              </td>
              <td className={cn(TD_NUM, netClass(budget.grandTotalNet), "font-bold")}>
                {formatNet(budget.grandTotalNet)}
              </td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>
      {anyPateo && (
        <p className="text-xs text-muted-foreground">
          * DALI PATEO revenue adjusted at 90.29% (Dartmouth F&amp;A 63.5%, 75%
          recovery). The adjustment applies to DALI PATEO rows only; all other
          types carry revenue through unchanged.
        </p>
      )}
    </div>
  );
}

function GroupRows({ group, termId }: { group: BudgetGroup; termId: string }) {
  const isBucket = group.projectId === null;
  return (
    <>
      <tr className="bg-muted/30">
        <td className="px-3 py-1.5 text-xs font-semibold text-foreground" colSpan={9}>
          {group.projectName}
        </td>
      </tr>
      {group.rows.map((row) => (
        <BudgetRowView
          key={`${group.projectId ?? ""}-${row.chartString}`}
          row={row}
          termId={termId}
          isBucket={isBucket}
        />
      ))}
      <tr className="bg-muted/20 text-foreground">
        <td className="px-3 py-1.5 text-xs italic" colSpan={3}>
          {group.projectName} subtotal
        </td>
        <td className={cn(TD_NUM, "text-xs font-semibold")}>
          {formatUsd(group.totalRevenue)}
        </td>
        <td className={cn(TD_NUM, "text-xs font-semibold")}>
          {formatUsd(group.totalAdjustedRevenue)}
        </td>
        <td className={cn(TD_NUM, "text-xs font-semibold")}>
          {formatUsd(group.totalExpense)}
        </td>
        <td className={cn(TD_NUM, "text-xs font-semibold", netClass(group.totalNet))}>
          {formatNet(group.totalNet)}
        </td>
        <td colSpan={2}></td>
      </tr>
    </>
  );
}

function BudgetRowView({
  row,
  termId,
  isBucket,
}: {
  row: BudgetRow;
  termId: string;
  isBucket: boolean;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const keyInputs = (
    <>
      <input type="hidden" name="projectId" value={row.projectId ?? ""} />
      <input type="hidden" name="chartString" value={row.chartString} />
      <input type="hidden" name="termId" value={termId} />
    </>
  );

  return (
    <>
      <tr className="hover:bg-muted/50">
        {/* Project name lives in the group header; the per-row cell stays blank. */}
        <td className={cn(TD, isBucket && "text-xs italic")}></td>
        <td className="px-3 py-2 font-mono text-xs text-foreground">
          {row.chartString}
        </td>
        <td className="px-3 py-2">
          <ProjectTypeSelect row={row} termId={termId} keyInputs={keyInputs} />
        </td>
        <td className="px-3 py-1.5 text-right">
          <RevenueEdit row={row} termId={termId} keyInputs={keyInputs} />
        </td>
        <td className={TD_NUM}>
          {row.adjustedRevenue > 0 || row.revenue > 0 ? (
            <>
              {formatUsd(row.adjustedRevenue)}
              {row.isPateo && <span className="ml-0.5 text-accent-coral">*</span>}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className={TD_NUM}>{formatUsd(row.expense)}</td>
        <td className={cn(TD_NUM, netClass(row.net), "font-semibold")}>
          {formatNet(row.net)}
        </td>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setNotesOpen((o) => !o)}
            aria-label={`${row.note ? "Edit" : "Add"} note for ${row.chartString}`}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              row.note && "text-accent-coral",
            )}
          >
            <StickyNote className="w-4 h-4" />
          </button>
        </td>
        <td className="px-3 py-2 text-right">
          {row.entryId && <DeleteButton entryId={row.entryId} />}
        </td>
      </tr>
      {notesOpen && (
        <tr className="bg-muted/20">
          <td colSpan={9} className="px-3 py-2">
            <NoteEditor
              row={row}
              termId={termId}
              keyInputs={keyInputs}
              onDone={() => setNotesOpen(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── inline editors ──────────────────────────────────────────────────────────

function RevenueEdit({
  row,
  termId: _termId,
  keyInputs,
}: {
  row: BudgetRow;
  termId: string;
  keyInputs: React.ReactNode;
}) {
  const fetcher = useFetcher();
  const [value, setValue] = useState(row.revenue.toFixed(2));
  const submitting = fetcher.state !== "idle";
  const wasSubmitting = useRef(false);

  // Re-sync the input when the server value changes after a save.
  useEffect(() => {
    if (submitting) wasSubmitting.current = true;
    else if (wasSubmitting.current) {
      wasSubmitting.current = false;
      setValue(row.revenue.toFixed(2));
    }
  }, [submitting, row.revenue]);

  return (
    <fetcher.Form method="post" action={BUDGET_ROUTE} className="inline-flex">
      <input type="hidden" name="intent" value="upsert-revenue" />
      {keyInputs}
      <input
        type="text"
        inputMode="decimal"
        name="revenue"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => {
          if (e.target.value !== row.revenue.toFixed(2)) {
            fetcher.submit(e.target.form);
          }
        }}
        aria-label={`Revenue for ${row.chartString}`}
        className="w-24 rounded border border-border bg-card px-2 py-1 text-right text-xs tabular-nums text-foreground focus:border-accent-coral focus:outline-none"
      />
    </fetcher.Form>
  );
}

function ProjectTypeSelect({
  row,
  termId: _termId,
  keyInputs,
}: {
  row: BudgetRow;
  termId: string;
  keyInputs: React.ReactNode;
}) {
  const fetcher = useFetcher();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <fetcher.Form method="post" action={BUDGET_ROUTE} ref={formRef}>
      <input type="hidden" name="intent" value="update-project-type" />
      {keyInputs}
      <SelectMenu
        name="projectType"
        defaultValue={row.projectType ?? ""}
        ariaLabel={`Project type for ${row.chartString}`}
        // Submit the picked value explicitly — override the (same-tick still
        // stale) projectType field rather than re-submitting the form's DOM.
        onChange={(value) => {
          const fd = new FormData(formRef.current!);
          fd.set("projectType", value);
          fetcher.submit(fd, { method: "post", action: BUDGET_ROUTE });
        }}
        options={[
          { value: "", label: "—" },
          ...PROJECT_TYPES.map((t) => ({ value: t, label: t })),
        ]}
        buttonClassName="rounded border border-border bg-card px-2 py-1 text-xs text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
      />
    </fetcher.Form>
  );
}

function NoteEditor({
  row,
  termId: _termId,
  keyInputs,
  onDone,
}: {
  row: BudgetRow;
  termId: string;
  keyInputs: React.ReactNode;
  onDone: () => void;
}) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== "idle";
  const wasSubmitting = useRef(false);

  useEffect(() => {
    if (submitting) wasSubmitting.current = true;
    else if (wasSubmitting.current) {
      wasSubmitting.current = false;
      onDone();
    }
  }, [submitting, onDone]);

  return (
    <fetcher.Form
      method="post"
      action={BUDGET_ROUTE}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="intent" value="upsert-note" />
      {keyInputs}
      <input
        type="text"
        name="note"
        defaultValue={row.note ?? ""}
        placeholder="Add a note…"
        autoFocus
        aria-label={`Note for ${row.chartString}`}
        className="flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-accent-coral focus:outline-none"
      />
      <button
        type="submit"
        className="rounded bg-accent-coral px-2 py-1 text-xs font-semibold text-white"
      >
        Save
      </button>
    </fetcher.Form>
  );
}

function DeleteButton({ entryId }: { entryId: string }) {
  const fetcher = useFetcher();
  const confirmSubmit = useConfirmSubmit();
  return (
    <fetcher.Form
      method="post"
      action={BUDGET_ROUTE}
      className="inline"
      onSubmit={confirmSubmit({
        title: "Delete this budget line?",
        description: "Expense will still show as an unbudgeted row.",
        confirmLabel: "Delete",
        tone: "destructive",
      })}
    >
      <input type="hidden" name="intent" value="delete-entry" />
      <input type="hidden" name="entryId" value={entryId} />
      <button
        type="submit"
        aria-label="Delete budget line"
        className="text-muted-foreground hover:text-red-600"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </fetcher.Form>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function netClass(net: number): string {
  if (net > 0) return "text-green-600";
  if (net < 0) return "text-red-600";
  return "text-muted-foreground";
}

function formatNet(net: number): string {
  return net < 0 ? `−${formatUsd(Math.abs(net))}` : formatUsd(net);
}
