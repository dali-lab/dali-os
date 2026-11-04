import { ChevronDown, ChevronUp } from "lucide-react";
import { useNavigate } from "react-router";
import { LoadMore } from "~/components/ui/Pager";
import { useClientSlice } from "~/hooks/useClientSlice";
import { cn } from "~/lib/cn";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import type { ApplicationSort, ApplicationSortKey } from "~/hiring/lib/application-filters";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_TONE: Record<string, string> = {
  Submitted: "bg-os-green/15 text-os-green",
  Draft: "bg-os-container text-os-grey",
  Withdrawn: "bg-os-amber/15 text-os-amber",
};

const SORT_DIRECTIONS = [
  { dir: "asc", Icon: ChevronUp, label: "ascending" },
  { dir: "desc", Icon: ChevronDown, label: "descending" },
] as const;

export interface ApplicationTableRow {
  id: string;
  name: string;
  domain: string;
  status: string;
  submittedAt: string | null;
  lateBy: string | null;
  reviewers: string | null;
  interviewers: string | null;
}

export function ApplicationsTable({
  rows,
  columns,
  activeSort,
  onSort,
  resetKey,
}: {
  rows: ApplicationTableRow[];
  columns: readonly { key: ApplicationSortKey; label: string }[];
  activeSort: ApplicationSort;
  onSort: (sort: ApplicationSort) => void;
  resetKey: string;
}) {
  const navigate = useNavigate();
  const { visible, pager } = useClientSlice(rows, { resetKey });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="text-os-grey text-xs">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                aria-sort={
                  activeSort.key !== col.key
                    ? undefined
                    : activeSort.dir === "asc"
                      ? "ascending"
                      : "descending"
                }
                className="text-left font-medium px-6 py-4"
              >
                <span className="inline-flex items-center gap-1.5">
                  {col.label}
                  <span className="inline-flex flex-col">
                    {SORT_DIRECTIONS.map(({ dir, Icon, label }) => {
                      const active = activeSort.key === col.key && activeSort.dir === dir;
                      return (
                        <button
                          key={dir}
                          type="button"
                          title={`Sort ${label}`}
                          aria-label={`Sort by ${col.label}, ${label}`}
                          aria-pressed={active}
                          onClick={() => onSort({ key: col.key, dir })}
                          className={cn(
                            "-my-0.5 rounded transition-colors hover:text-foreground",
                            active ? "text-os-accent" : "text-os-grey/50",
                          )}
                        >
                          <Icon className="h-3 w-3" strokeWidth={3} aria-hidden />
                        </button>
                      );
                    })}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr
              key={r.id}
              onClick={() => navigate(`/hiring/applications/${r.id}`)}
              className="border-t border-os-container hover:bg-os-card-hover cursor-pointer transition-colors"
            >
              <td className="px-6 py-3.5 font-medium text-foreground">
                {r.name}
              </td>
              <td className="px-6 py-3.5 text-foreground">{r.domain}</td>
              <td className="px-6 py-3.5">
                <span
                  className={cn(
                    "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold",
                    STATUS_TONE[r.status] ?? STATUS_TONE.Draft,
                  )}
                >
                  {r.status}
                </span>
              </td>
              {columns.some((c) => c.key === "submittedAt") && (
                <td className="px-6 py-3.5 text-os-grey">
                  <span className="inline-flex items-center gap-2">
                    {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                    {r.lateBy && <Pill dot="warning">{r.lateBy}</Pill>}
                  </span>
                </td>
              )}
              {columns.some((c) => c.key === "reviewers") && (
                <td className="px-6 py-3.5 text-os-grey">{r.reviewers ?? "—"}</td>
              )}
              {columns.some((c) => c.key === "interviewers") && (
                <td className="px-6 py-3.5 text-os-grey">{r.interviewers ?? "—"}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <LoadMore {...pager} />
    </div>
  );
}
