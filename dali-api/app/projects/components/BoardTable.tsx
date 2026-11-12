import { Link, useFetcher, useNavigate, useSearchParams } from "react-router";
import {
  ResponseTable,
  type ColumnControls,
  type FixedColumn,
  type TableColumn,
} from "~/forms/components/ResponseTable";
import { CsvLink } from "~/forms/components/ResultsControls";
import {
  BOARD_COLUMN_BUILTINS,
  BUILTIN_SOURCES,
  isBoardColumnBuiltin,
} from "~/projects/lib/slot-roles";
import type { Slot } from "~/projects/lib/form-slots";

type BoardRow = { userId: string; name: string };

const builtinOf = (key: string) => {
  const name = key.startsWith("builtin:") ? key.slice("builtin:".length) : null;
  return isBoardColumnBuiltin(name) ? name : null;
};

function useBoardColumns(columns: TableColumn[]): ColumnControls {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const shown = new Set(columns.flatMap((c) => builtinOf(c.key) ?? []));
  const save = (builtin: string, visible: boolean) =>
    fetcher.submit(
      { intent: "set-slot-column", builtin, shown: visible ? "1" : "0" },
      { method: "post", preventScrollReset: true },
    );
  return {
    available: BOARD_COLUMN_BUILTINS.filter((b) => !shown.has(b)).map((b) => ({
      key: b,
      label: BUILTIN_SOURCES[b].defaultLabel,
    })),
    onAdd: (key) => save(key, true),
    removable: (key) => builtinOf(key) !== null,
    onRemove: (key) => {
      const b = builtinOf(key);
      if (b) save(b, false);
    },
  };
}

// A slot board's submissions in the shared responses table. Managers get the
// + button and column menu on a single-term board.
export function BoardTable<R extends BoardRow & { cells: Record<string, string> }>({
  columns,
  rows,
  detailHref,
  editable,
  trailing,
  emptyMessage,
}: {
  columns: TableColumn[];
  rows: R[];
  detailHref: (row: R) => string;
  editable: boolean;
  trailing?: FixedColumn<R>[];
  emptyMessage: string;
}) {
  const navigate = useNavigate();
  const controls = useBoardColumns(columns);
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
