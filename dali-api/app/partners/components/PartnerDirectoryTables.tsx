import { type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import { LoadMore } from "~/components/ui/Pager";
import { useClientSlice } from "~/hooks/useClientSlice";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import { ContactAvatar } from "./contact/ContactAvatar";
import { OrgAvatar } from "./org/OrgAvatar";
import { OrgStatusPill } from "./org/OrgStatusPill";
import {
  DIRECTORY_KIND_LABELS,
  DIRECTORY_ROW_CLASS,
  directoryRowHref,
  type DirectorySort,
  type DirectorySortKey,
  type PartnerDirectoryRow,
} from "../lib/partner-directory";
import { PARTNER_ORG_TYPE_LABELS } from "../lib/partner-org";

const TH = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-os-muted first:pl-6 last:pr-6";
const TD = "px-4 py-3 text-sm first:pl-6 last:pr-6";

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: DirectorySortKey;
  sort: DirectorySort;
  onSort: (key: DirectorySortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={TH}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "group/sort inline-flex items-center gap-1 font-semibold transition-colors",
          active ? "text-foreground" : "hover:text-foreground",
        )}
      >
        {label}
        <Icon
          className={cn(
            "h-3 w-3",
            active ? "text-os-accent" : "opacity-0 group-hover/sort:opacity-60 focus-visible:opacity-60",
          )}
          aria-hidden
        />
      </button>
    </th>
  );
}

function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-os-accent"
    >
      {children}
    </Link>
  );
}

function rowSubtitle(row: PartnerDirectoryRow): string | null {
  if (row.kind === "person") return row.title;
  if (row.kind === "individual") return row.email;
  return row.website?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null;
}

export function DirectoryTable({
  rows,
  sort,
  onSort,
  resetKey,
}: {
  rows: PartnerDirectoryRow[];
  sort: DirectorySort;
  onSort: (key: DirectorySortKey) => void;
  resetKey: string;
}) {
  const { visible, pager } = useClientSlice(rows, { resetKey });
  const dash = <span aria-hidden>—</span>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr>
            <SortableTh label="Name" sortKey="name" sort={sort} onSort={onSort} />
            <th className={TH}>Kind</th>
            <th className={TH}>Organization</th>
            <th className={TH}>Status</th>
            <th className={TH}>Active projects</th>
            <SortableTh label="Last activity" sortKey="activity" sort={sort} onSort={onSort} />
            <th className={cn(TH, "w-10")} aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const subtitle = rowSubtitle(r);
            return (
              <tr key={`${r.kind}-${r.id}`} className={DIRECTORY_ROW_CLASS}>
                <td className={TD}>
                  <RowLink to={directoryRowHref(r)}>
                    {r.kind === "person" ? (
                      <ContactAvatar contact={r} />
                    ) : (
                      <OrgAvatar org={{ name: r.name, logoUrl: r.logoUrl }} />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{r.name}</span>
                      {subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {subtitle}
                        </span>
                      )}
                    </span>
                  </RowLink>
                </td>
                <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
                  {r.kind === "org" && r.type
                    ? PARTNER_ORG_TYPE_LABELS[r.type]
                    : DIRECTORY_KIND_LABELS[r.kind]}
                </td>
                <td className={cn(TD, "max-w-[220px] truncate text-muted-foreground")}>
                  {r.orgNames.length > 0 ? r.orgNames.join(", ") : dash}
                </td>
                <td className={TD}>{r.status ? <OrgStatusPill status={r.status} /> : dash}</td>
                <td className={cn(TD, "tabular-nums text-muted-foreground")}>
                  {r.activeProjectCount ?? dash}
                </td>
                <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
                  {r.lastActivityAt ? relativeTime(r.lastActivityAt) : dash}
                </td>
                <td className={cn(TD, "w-10 text-right text-muted-foreground")}>
                  <ChevronRight
                    className="ml-auto h-4 w-4 opacity-60 group-hover:opacity-100"
                    aria-hidden
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <LoadMore {...pager} />
    </div>
  );
}
