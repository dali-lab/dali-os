import { useEffect, useState, type ReactNode } from "react";
import { useFetcher, useSearchParams } from "react-router";
import {
  ResponseTable,
  type ColumnControls,
  type FixedColumn,
  type TableColumn,
} from "~/forms/components/ResponseTable";
import { ResponseDrawer } from "~/forms/components/ResponseDrawer";
import { CsvLink } from "~/forms/components/ResultsControls";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { useToast } from "~/components/ui/toast";
import { StatusAnswerMap } from "./SlotColumnMapper";
import {
  parseRoleChoice,
  type BoardColumn,
  type RoleChoice,
} from "~/projects/lib/slot-roles";
import type { IntentStatusValue } from "~/projects/lib/intent-status";
import type { ColumnOp } from "~/forms/lib/column-ops";
import type { Slot } from "~/projects/lib/form-slots";
import { OPEN_PARAM } from "~/projects/lib/board-filters";

type BoardRow = {
  userId: string;
  name: string;
  email: string | null;
  cells: Record<string, string>;
  detailFields: { key: string; label: string; value: string; mapped: boolean }[];
};


function useColumnEdits() {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const toast = useToast();
  const error = fetcher.state === "idle" ? fetcher.data?.error : undefined;
  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);
  return (op: ColumnOp) =>
    fetcher.submit(
      { intent: "set-slot-column", op: JSON.stringify(op) },
      { method: "post", preventScrollReset: true },
    );
}

function StatusAnswersDialog({
  column,
  onSave,
  onClose,
}: {
  column: BoardColumn;
  onSave: (statusMap: Record<string, IntentStatusValue>) => void;
  onClose: () => void;
}) {
  const [statusMap, setStatusMap] = useState(column.status?.statusMap ?? {});
  return (
    <Modal open onClose={onClose} labelledBy="status-answers-title" containerClassName={modalCardClass("max-w-lg")}>
      <ModalHeader
        titleId="status-answers-title"
        title="Status answers"
        subtitle={`What each answer to "${column.label}" means for staffing.`}
        onClose={onClose}
      />
      <StatusAnswerMap
        options={column.status?.options ?? []}
        statusMap={statusMap}
        canManage
        disabled={false}
        onChange={setStatusMap}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            onSave(statusMap);
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

// A slot board's submissions in the shared responses table, with the same
// detail drawer as form results. Managers get the + button and column menus
// on a single-term board.
export function BoardTable<R extends BoardRow>({
  columns,
  addable,
  roleChoices,
  rows,
  editable,
  trailing,
  drawerFooter,
  emptyMessage,
}: {
  columns: BoardColumn[];
  addable: TableColumn[];
  roleChoices: RoleChoice[];
  rows: R[];
  editable: boolean;
  trailing?: FixedColumn<R>[];
  drawerFooter?: (row: R) => ReactNode;
  emptyMessage: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const edit = useColumnEdits();
  const [statusColumn, setStatusColumn] = useState<BoardColumn | null>(null);
  const openId = searchParams.get(OPEN_PARAM);
  const open = rows.find((r) => r.userId === openId) ?? null;
  const setOpen = (userId: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (userId) next.set(OPEN_PARAM, userId);
        else next.delete(OPEN_PARAM);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const controls: ColumnControls = {
    available: addable,
    edit,
    roleMenu: (key) => {
      const role = columns.find((c) => c.key === key)?.role;
      return role ? { choices: roleChoices, value: role } : null;
    },
    onRole: (key, value) => edit({ op: "role", id: key, ...parseRoleChoice(value) }),
    extraItems: (key) => {
      const column = columns.find((c) => c.key === key);
      return column?.status ? [{ label: "Status answers", onSelect: () => setStatusColumn(column) }] : [];
    },
  };

  return (
    <>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <ResponseTable
          lead={[
            {
              key: "member",
              label: "Member",
              cell: (r) => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(r.userId);
                  }}
                  className="text-left hover:underline"
                >
                  {r.name}
                </button>
              ),
            },
          ]}
          columns={columns}
          trailing={trailing}
          rows={rows}
          rowKey={(r) => r.userId}
          value={(r, key) => r.cells[key] ?? ""}
          onOpen={(r) => setOpen(r.userId)}
          controls={editable ? controls : null}
        />
      )}
      <ResponseDrawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.name ?? ""}
        subtitle={open?.email ?? undefined}
        fields={(open?.detailFields ?? []).map((f) => ({
          key: f.key,
          label: f.label,
          value: f.value,
          ...(f.mapped ? {} : { note: "Not in the table" }),
        }))}
        footer={open && drawerFooter?.(open)}
      />
      {statusColumn && (
        <StatusAnswersDialog
          column={statusColumn}
          onClose={() => setStatusColumn(null)}
          onSave={(statusMap) => edit({ op: "statusMap", id: statusColumn.key, statusMap })}
        />
      )}
    </>
  );
}

// The board's CSV: what the table shows for the URL's term, search and filters.
export function BoardCsvLink({
  slot,
  matching,
  total,
}: {
  slot: Slot;
  matching: number;
  total: number;
}) {
  const [searchParams] = useSearchParams();
  const params = new URLSearchParams(searchParams);
  params.delete("settings");
  params.delete(OPEN_PARAM);
  params.set("slot", slot);
  return (
    <CsvLink
      href={`/core/board-export.csv?${params}`}
      matching={matching === total ? undefined : matching}
      allTip="Export every submission for this term as CSV"
    />
  );
}
