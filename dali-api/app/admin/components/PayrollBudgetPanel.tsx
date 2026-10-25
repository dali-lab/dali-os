import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Trash2, StickyNote } from "lucide-react";
import { EmptyState, adminTable } from "~/admin/components/console-ui";
import { useOsChrome } from "~/components/os-chrome";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatUsd } from "~/lib/money";
import { cn } from "~/lib/cn";
import { PROJECT_TYPES } from "~/admin/lib/budget.shared";
import { Select, Tooltip } from "~/components/ui/floating";
import type {
  BudgetData,
  BudgetGroup,
  BudgetRow,
} from "~/admin/lib/budget.shared";
import type { BudgetLoaderData } from "~/admin/routes/admin.payroll.budget";

const TH = adminTable.th;
const TH_NUM = cn(adminTable.th, "text-right");
const TD = cn(adminTable.td, "text-os-grey");
const TD_NUM = cn(adminTable.td, "text-right tabular-nums text-foreground");

function PanelMessage({ children }: { children: React.ReactNode }) {
  const { panel } = useOsChrome();
  return (
    <div className={panel}>
      <EmptyState>{children}</EmptyState>
    </div>
  );
}

const BUDGET_ROUTE = "/admin/payroll/budget";

export function PayrollBudgetPanel({ term }: { term: string }) {
  const fetcher = useFetcher<BudgetLoaderData>();

  useEffect(() => {
    fetcher.load(`${BUDGET_ROUTE}?term=${encodeURIComponent(term)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  if (fetcher.state === "loading" && !fetcher.data) {
    return <PanelMessage>Loading budget…</PanelMessage>;
  }
  if (!fetcher.data) {
    return <PanelMessage>Loading budget…</PanelMessage>;
  }
  if (!fetcher.data.ok) {
    return (
      <PanelMessage>{fetcher.data.error}</PanelMessage>
    );
  }

  const { budget, termId } = fetcher.data;
  return <BudgetTable budget={budget} termId={termId} />;
}

function BudgetTable({ budget, termId }: { budget: BudgetData; termId: string }) {
  const anyPateo = budget.groups.some((g) => g.rows.some((r) => r.isPateo));

  if (budget.groups.length === 0) {
    return (
      <PanelMessage>
        No budget lines for this term yet. Revenue and expense appear here once
        timesheets are uploaded or revenue is entered.
      </PanelMessage>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={adminTable.wrap}>
        <table className="w-full min-w-[960px]">
          <thead>
            <tr>
              <th className={TH}>Project</th>
              <th className={TH}>Chart string</th>
              <th className={TH}>Type</th>
              <th className={TH_NUM}>Revenue</th>
              <th className={TH_NUM}>Adj. revenue</th>
              <th className={TH_NUM}>Expense</th>
              <th className={TH_NUM}>Net</th>
              <th className={TH}>Notes</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {budget.groups.map((g) => (
              <GroupRows key={g.projectId ?? "__none__"} group={g} termId={termId} />
            ))}
            <tr className="border-t border-os-container font-semibold text-foreground">
              <td className={adminTable.td} colSpan={3}>
                Grand total
              </td>
              <td className={cn(TD_NUM, "font-semibold")}>
                {formatUsd(budget.grandTotalRevenue)}
              </td>
              <td className={cn(TD_NUM, "font-semibold")}>
                {formatUsd(budget.grandTotalAdjustedRevenue)}
              </td>
              <td className={cn(TD_NUM, "font-semibold")}>
                {formatUsd(budget.grandTotalExpense)}
              </td>
              <td className={cn(TD_NUM, netClass(budget.grandTotalNet), "font-semibold")}>
                {formatNet(budget.grandTotalNet)}
              </td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>
      {anyPateo && (
        <p className="text-xs text-os-muted">
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
      <tr className={cn(adminTable.row, "bg-os-well/60")}>
        <td className="px-6 py-2 text-xs font-semibold text-foreground" colSpan={9}>
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
      <tr className={cn(adminTable.row, "text-foreground")}>
        <td className={cn(adminTable.td, "text-xs text-os-grey")} colSpan={3}>
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
  const { iconBtn } = useOsChrome();
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
      <tr className={adminTable.row}>
        <td className={cn(TD, isBucket && "text-xs italic")}></td>
        <td className={cn(adminTable.td, "font-mono text-xs text-foreground")}>
          {row.chartString}
        </td>
        <td className={adminTable.td}>
          <ProjectTypeSelect row={row} termId={termId} keyInputs={keyInputs} />
        </td>
        <td className={cn(adminTable.td, "text-right")}>
          <RevenueEdit row={row} termId={termId} keyInputs={keyInputs} />
        </td>
        <td className={TD_NUM}>
          {row.adjustedRevenue > 0 || row.revenue > 0 ? (
            <>
              {formatUsd(row.adjustedRevenue)}
              {row.isPateo && <span className="ml-0.5 text-os-accent">*</span>}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className={TD_NUM}>{formatUsd(row.expense)}</td>
        <td className={cn(TD_NUM, netClass(row.net), "font-semibold")}>
          {formatNet(row.net)}
        </td>
        <td className={adminTable.td}>
          <Tooltip content={row.note ? row.note : "Add note"}>
            <button
              type="button"
              onClick={() => setNotesOpen((o) => !o)}
              aria-label={`${row.note ? "Edit" : "Add"} note for ${row.chartString}`}
              aria-expanded={notesOpen}
              className={cn(iconBtn, row.note && "text-os-accent")}
            >
              <StickyNote className="h-4 w-4" />
            </button>
          </Tooltip>
        </td>
        <td className={cn(adminTable.td, "text-right")}>
          {row.entryId && <DeleteButton entryId={row.entryId} />}
        </td>
      </tr>
      {notesOpen && (
        <tr className="bg-os-well/60">
          <td colSpan={9} className="px-6 py-3">
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
  const { compactField } = useOsChrome();
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
        className={cn(compactField, "w-28 border border-os-container px-2.5 py-1.5 text-right text-xs tabular-nums focus:outline-none")}
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
  const { compactField } = useOsChrome();
  const fetcher = useFetcher();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <fetcher.Form method="post" action={BUDGET_ROUTE} ref={formRef}>
      <input type="hidden" name="intent" value="update-project-type" />
      {keyInputs}
      <Select
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
        buttonClassName={cn(compactField, "inline-flex min-w-[8rem] items-center justify-between gap-1 border border-os-container px-2.5 py-1.5 text-xs transition-colors hover:border-os-container-hi")}
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
  const { compactField, actionBtnPrimary } = useOsChrome();
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
        placeholder="Add a note"
        autoFocus
        aria-label={`Note for ${row.chartString}`}
        className={cn(compactField, "flex-1 border border-os-container px-3 py-1.5 text-sm focus:outline-none")}
      />
      <button type="submit" disabled={submitting} className={cn(actionBtnPrimary, "disabled:opacity-50")}>
        {submitting ? "Saving…" : "Save"}
      </button>
    </fetcher.Form>
  );
}

function DeleteButton({ entryId }: { entryId: string }) {
  const { iconBtn } = useOsChrome();
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
      <Tooltip content="Delete budget line">
        <button
          type="submit"
          aria-label="Delete budget line"
          className={cn(iconBtn, "hover:text-destructive")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </Tooltip>
    </fetcher.Form>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function netClass(net: number): string {
  if (net > 0) return "text-os-green";
  if (net < 0) return "text-destructive";
  return "text-os-muted";
}

function formatNet(net: number): string {
  return net < 0 ? `−${formatUsd(Math.abs(net))}` : formatUsd(net);
}
