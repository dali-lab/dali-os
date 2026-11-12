import { Link, useFetcher, useNavigate, useSearchParams } from "react-router";
import {
  ResponseTable,
  type ColumnControls,
  type FixedColumn,
  type TableColumn,
} from "~/forms/components/ResponseTable";
import { CsvLink } from "~/forms/components/ResultsControls";
import {
  parseRoleChoice,
  type BoardColumn,
  type RoleChoice,
} from "~/projects/lib/slot-roles";
import type { ColumnOp } from "~/forms/lib/column-ops";
import type { Slot } from "~/projects/lib/form-slots";

type BoardRow = { userId: string; name: string };

function useBoardColumns(
  columns: BoardColumn[],
  addable: TableColumn[],
  roleChoices: RoleChoice[],
): ColumnControls {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const edit = (op: ColumnOp) =>
    fetcher.submit(
      { intent: "set-slot-column", op: JSON.stringify(op) },
      { method: "post", preventScrollReset: true },
    );
  return {
    available: addable,
    edit,
    roleMenu: (key) => {
      const role = columns.find((c) => c.key === key)?.role;
      return role ? { choices: roleChoices, value: role } : null;
    },
    onRole: (key, value) => edit({ op: "role", id: key, ...parseRoleChoice(value) }),
  };
}

// A slot board's submissions in the shared responses table. Managers get the
// + button and column menu on a single-term board.
export function BoardTable<R extends BoardRow & { cells: Record<string, string> }>({
  columns,
  addable,
  roleChoices,
  rows,
  detailHref,
  editable,
  trailing,
  emptyMessage,
}: {
  columns: BoardColumn[];
  addable: TableColumn[];
  roleChoices: RoleChoice[];
  rows: R[];
  detailHref: (row: R) => string;
  editable: boolean;
  trailing?: FixedColumn<R>[];
  emptyMessage: string;
}) {
  const navigate = useNavigate();
  const controls = useBoardColumns(columns, addable, roleChoices);
  if (rows.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
  }
  return (
    <ResponseTable
      lead={[
        {
          key: "member",
          label: "Member",
          cell: (r) => (
            <Link to={detailHref(r)} onClick={(e) => e.stopPropagation()} className="hover:underline">
              {r.name}
            </Link>
          ),
        },
      ]}
      columns={columns}
      trailing={trailing}
      rows={rows}
      rowKey={(r) => r.userId}
      value={(r, key) => r.cells[key] ?? ""}
      onOpen={(r) => navigate(detailHref(r))}
      controls={editable ? controls : null}
    />
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
  params.set("slot", slot);
  return (
    <CsvLink
      href={`/core/board-export.csv?${params}`}
      matching={matching === total ? undefined : matching}
      allTip="Export every submission for this term as CSV"
    />
  );
}
