// Shared, view-only submissions table for the Project Bids and Intent to
// Work boards. Columns + their order/labels come entirely from the slot's
// saved mapping (resolved by the loader via submission-columns.ts); this
// component just renders them. Each row links to that submission's detail
// page, where hidden (not-in-table) columns are also shown.

import { useNavigate } from "react-router";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";

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
  // Path the row links under: `${detailBase-path}/${userId}`. May carry a
  // `?term=` query string (caller builds it); we splice the userId into the
  // path so the query stays after it: `/base/userId?term=...`.
  detailBase: string;
  emptyMessage: string;
}) {
  const navigate = useNavigate();

  const detailUrl = (userId: string) => {
    const [path, query] = detailBase.split("?");
    const base = `${path.replace(/\/$/, "")}/${userId}`;
    return query ? `${base}?${query}` : base;
  };

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
              onClick={() => {
                const url = detailUrl(r.userId);
                if (!requestOpenTabIfEmbedded(url, r.name)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2">
                <span className="text-foreground">{r.name}</span>
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
