import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Menu } from "~/components/ui/floating";
import { IconButton } from "~/components/ui/IconButton";

export type TableColumn = { key: string; label: string };

// A column outside the data columns: who responded and when up front, row
// actions at the end.
export type FixedColumn<R> = {
  key: string;
  label: ReactNode;
  cell: (row: R) => ReactNode;
  className?: string;
};

// The + button and per-column remove menu. Only for people who can change
// the table's columns.
export type ColumnControls = {
  available: TableColumn[];
  onAdd: (key: string) => void;
  removable: (key: string) => boolean;
  onRemove: (key: string) => void;
};

const TH = "text-left font-medium px-4 py-3";

// The responses table shared by form results and the staffing boards.
export function ResponseTable<R>({
  lead,
  columns,
  trailing = [],
  rows,
  rowKey,
  value,
  onOpen,
  controls,
}: {
  lead: FixedColumn<R>[];
  columns: TableColumn[];
  trailing?: FixedColumn<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  value: (row: R, key: string) => string;
  onOpen: (row: R) => void;
  controls?: ColumnControls | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="text-os-grey text-xs">
          <tr>
            {lead.map((c) => (
              <th key={c.key} className={TH}>
                {c.label}
              </th>
            ))}
            {columns.map((c) => (
              <th key={c.key} className={TH}>
                {controls?.removable(c.key) ? (
                  <RemovableHeader label={c.label} onRemove={() => controls.onRemove(c.key)} />
                ) : (
                  <div className="max-w-[16rem] truncate" title={c.label}>
                    {c.label}
                  </div>
                )}
              </th>
            ))}
            {trailing.map((c) => (
              <th key={c.key} className={TH}>
                {c.label}
              </th>
            ))}
            {controls && (
              <th className="w-10 px-2 py-1.5 text-right">
                <AddColumnMenu available={controls.available} onAdd={controls.onAdd} />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={() => onOpen(r)}
              className="border-t border-os-container hover:bg-os-card-hover cursor-pointer"
            >
              {lead.map((c, i) => (
                <td
                  key={c.key}
                  className={
                    c.className ??
                    (i === 0
                      ? "px-4 py-2.5 text-foreground font-medium whitespace-nowrap"
                      : "px-4 py-2.5 text-muted-foreground")
                  }
                >
                  {c.cell(r)}
                </td>
              ))}
              {columns.map((c) => {
                const v = value(r, c.key);
                return (
                  <td key={c.key} className="px-4 py-2.5 text-foreground">
                    <div className="max-w-[16rem] truncate" title={v || undefined}>
                      {v || "—"}
                    </div>
                  </td>
                );
              })}
              {trailing.map((c) => (
                <td
                  key={c.key}
                  className={c.className ?? "px-4 py-2.5"}
                  onClick={(e) => e.stopPropagation()}
                >
                  {c.cell(r)}
                </td>
              ))}
              {controls && <td />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddColumnMenu({
  available,
  onAdd,
}: {
  available: TableColumn[];
  onAdd: (key: string) => void;
}) {
  return (
    <Menu
      align="right"
      ariaLabel="Add a column"
      trigger={<IconButton label="Add a column" icon={Plus} tooltipSide="top" />}
    >
      {available.length > 0 ? (
        available.map((c) => (
          <Menu.Item key={c.key} onSelect={() => onAdd(c.key)}>
            {c.label}
          </Menu.Item>
        ))
      ) : (
        <Menu.Item disabled>Every column is added</Menu.Item>
      )}
    </Menu>
  );
}

function RemovableHeader({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Menu
      ariaLabel={`${label} column`}
      trigger={
        <button
          type="button"
          className="max-w-[16rem] truncate text-left font-medium hover:text-foreground"
          title={label}
        >
          {label}
        </button>
      }
    >
      <Menu.Item icon={<X className="h-3.5 w-3.5" />} onSelect={onRemove}>
        Remove column
      </Menu.Item>
    </Menu>
  );
}
