import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, EyeOff, Pencil, Plus } from "lucide-react";
import { Menu } from "~/components/ui/floating";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { MAX_COLUMN_LABEL, type ColumnOp } from "~/forms/lib/column-ops";

export type TableColumn = { key: string; label: string };

// A column outside the data columns: who responded and when up front, row
// actions at the end.
export type FixedColumn<R> = {
  key: string;
  label: ReactNode;
  cell: (row: R) => ReactNode;
  className?: string;
};

export type RoleMenu = { choices: { value: string; label: string }[]; value: string };

// The + button and each column's menu. Only for people who can change the
// table's columns.
export type ColumnControls = {
  // Columns the + button can show: hidden ones and ones not added yet.
  available: TableColumn[];
  edit: (op: ColumnOp) => void;
  // "Feeds staffing as" for a column, on a board's question columns.
  roleMenu?: (key: string) => RoleMenu | null;
  onRole?: (key: string, value: string) => void;
  // More items for one column's menu, shown above Hide.
  extraItems?: (key: string) => { label: string; onSelect: () => void }[];
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
            {columns.map((c, i) => (
              <th key={c.key} className={TH}>
                {controls ? (
                  <ColumnMenu
                    column={c}
                    first={i === 0}
                    last={i === columns.length - 1}
                    controls={controls}
                  />
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
                <AddColumnMenu
                  available={controls.available}
                  onAdd={(id) => controls.edit({ op: "show", id })}
                />
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

function ColumnMenu({
  column,
  first,
  last,
  controls,
}: {
  column: TableColumn;
  first: boolean;
  last: boolean;
  controls: ColumnControls;
}) {
  const dialog = useDialog();
  const id = column.key;
  const roles = controls.roleMenu?.(id) ?? null;
  async function rename() {
    const label = await dialog.prompt({
      title: "Rename column",
      label: "Column name",
      defaultValue: column.label,
      confirmLabel: "Rename",
      validate: (v) =>
        !v.trim()
          ? "Give the column a name."
          : v.trim().length > MAX_COLUMN_LABEL
            ? `Keep it under ${MAX_COLUMN_LABEL} characters.`
            : null,
    });
    if (label !== null && label.trim() !== column.label) {
      controls.edit({ op: "rename", id, label: label.trim() });
    }
  }
  return (
    <Menu
      ariaLabel={`${column.label} column`}
      trigger={
        <button
          type="button"
          className="max-w-[16rem] truncate text-left font-medium hover:text-foreground"
          title={column.label}
        >
          {column.label}
        </button>
      }
    >
      <Menu.Item icon={<Pencil className="h-3.5 w-3.5" />} onSelect={() => void rename()}>
        Rename
      </Menu.Item>
      <Menu.Item
        icon={<ArrowLeft className="h-3.5 w-3.5" />}
        disabled={first}
        onSelect={() => controls.edit({ op: "move", id, dir: -1 })}
      >
        Move left
      </Menu.Item>
      <Menu.Item
        icon={<ArrowRight className="h-3.5 w-3.5" />}
        disabled={last}
        onSelect={() => controls.edit({ op: "move", id, dir: 1 })}
      >
        Move right
      </Menu.Item>
      {roles && (
        <Menu.Sub label="Feeds staffing as">
          {roles.choices.map((r) => (
            <Menu.Item
              key={r.value}
              checked={r.value === roles.value}
              onSelect={() => r.value !== roles.value && controls.onRole?.(id, r.value)}
            >
              {r.label}
            </Menu.Item>
          ))}
        </Menu.Sub>
      )}
      {controls.extraItems?.(id).map((x) => (
        <Menu.Item key={x.label} onSelect={x.onSelect}>
          {x.label}
        </Menu.Item>
      ))}
      <Menu.Separator />
      <Menu.Item
        icon={<EyeOff className="h-3.5 w-3.5" />}
        onSelect={() => controls.edit({ op: "hide", id })}
      >
        Hide column
      </Menu.Item>
    </Menu>
  );
}
