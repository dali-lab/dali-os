// Shared, view-only submissions table for the Project Bids and Intent to
// Work boards. Columns + their order/labels come entirely from the slot's
// saved mapping (resolved by the loader via submission-columns.ts); this
// component just renders them. Each row links to that submission's detail
// page, where hidden (not-in-table) columns are also shown.

import { Link } from "react-router";

export type DbColumn = { key: string; label: string };

export type DbRow = {
  userId: string;
  name: string;
  email: string | null;
  // columnKey → display string (already resolved by the loader).
  cells: Record<string, string>;
};

export function SubmissionDatabase({
  columns,
  rows,
  detailBase,
  emptyMessage,
}: {
  columns: DbColumn[];
  rows: DbRow[];
  // Row links to `${detailBase}/${userId}` (term query string already on it
  // if needed — caller builds it).
  detailBase: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Member</th>
            {columns.map((c) => (
              <th key={c.key} className="text-left font-medium px-4 py-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.userId}
              className="border-t border-border hover:bg-muted/20"
            >
              <td className="px-4 py-2">
                <Link
                  to={`${detailBase}/${r.userId}`}
                  className="text-accent-coral hover:underline"
                >
                  {r.name}
                </Link>
                {r.email && (
                  <div className="text-xs text-muted-foreground">
                    {r.email}
                  </div>
                )}
              </td>
              {columns.map((c) => {
                const v = r.cells[c.key] ?? "";
                return (
                  <td key={c.key} className="px-4 py-2 text-foreground">
                    {v === "" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      v
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
