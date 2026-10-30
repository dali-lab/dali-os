import { type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { LoadMore } from "~/components/ui/Pager";
import { useClientSlice } from "~/hooks/useClientSlice";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import { ContactAvatar } from "./contact/ContactAvatar";
import {
  DIRECTORY_ROW_CLASS,
  orgInitials,
  type DirectorySort,
  type DirectorySortKey,
  type PartnerContactDirectoryRow,
  type PartnerOrgDirectoryRow,
} from "../lib/partner-directory";
import {
  PARTNER_ORG_TYPE_LABELS,
  PARTNER_RELATIONSHIP_STATUS_LABELS,
  type PartnerRelationshipStatus,
} from "../lib/partner-org";

const STATUS_DOT: Record<PartnerRelationshipStatus, string> = {
  Active: "bg-os-green",
  Prospect: "bg-os-accent",
  Dormant: "bg-os-amber",
  Past: "bg-os-muted",
};

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

function RowLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (requestOpenTabIfEmbedded(to, label)) e.preventDefault();
  };
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-os-accent"
    >
      {children}
    </Link>
  );
}

function StatusPill({ status }: { status: PartnerRelationshipStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-os-well px-2.5 py-0.5 text-xs text-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} aria-hidden />
      {PARTNER_RELATIONSHIP_STATUS_LABELS[status]}
    </span>
  );
}

function Chevron() {
  return (
    <td className={cn(TD, "w-10 text-right text-muted-foreground")}>
      <ChevronRight className="ml-auto h-4 w-4 opacity-60 group-hover:opacity-100" aria-hidden />
    </td>
  );
}

export function OrgsTable({
  rows,
  sort,
  onSort,
  resetKey,
}: {
  rows: PartnerOrgDirectoryRow[];
  sort: DirectorySort;
  onSort: (key: DirectorySortKey) => void;
  resetKey: string;
}) {
  const { visible, pager } = useClientSlice(rows, { resetKey });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr>
            <SortableTh label="Organization" sortKey="name" sort={sort} onSort={onSort} />
            <th className={TH}>Type</th>
            <th className={TH}>Status</th>
            <th className={TH}>Members</th>
            <th className={TH}>Active projects</th>
            <SortableTh label="Last activity" sortKey="activity" sort={sort} onSort={onSort} />
            <th className={cn(TH, "w-10")} aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {visible.map((o) => (
            <tr key={o.id} className={DIRECTORY_ROW_CLASS}>
              <td className={TD}>
                <RowLink to={`/core/partners/orgs/${o.id}`} label={o.name}>
                  <span
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-os-well text-[11px] font-semibold text-os-grey"
                    aria-hidden
                  >
                    {orgInitials(o.name)}
                  </span>
                  <span className="truncate font-medium text-foreground">{o.name}</span>
                </RowLink>
              </td>
              <td className={cn(TD, "text-muted-foreground")}>
                {o.isIndividual ? "Individual" : o.type ? PARTNER_ORG_TYPE_LABELS[o.type] : "—"}
              </td>
              <td className={TD}>
                <StatusPill status={o.status} />
              </td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{o.memberCount}</td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{o.activeProjectCount}</td>
              <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
                {o.lastActivityAt ? relativeTime(o.lastActivityAt) : "—"}
              </td>
              <Chevron />
            </tr>
          ))}
        </tbody>
      </table>
      <LoadMore {...pager} />
    </div>
  );
}

export function ContactsTable({
  rows,
  sort,
  onSort,
  resetKey,
}: {
  rows: PartnerContactDirectoryRow[];
  sort: DirectorySort;
  onSort: (key: DirectorySortKey) => void;
  resetKey: string;
}) {
  const { visible, pager } = useClientSlice(rows, { resetKey });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr>
            <SortableTh label="Contact" sortKey="name" sort={sort} onSort={onSort} />
            <th className={TH}>Organization</th>
            <th className={TH}>Applications</th>
            <SortableTh label="Last activity" sortKey="activity" sort={sort} onSort={onSort} />
            <th className={cn(TH, "w-10")} aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <tr key={c.id} className={DIRECTORY_ROW_CLASS}>
              <td className={TD}>
                <RowLink to={`/core/partners/contacts/${c.id}`} label={c.name}>
                  <ContactAvatar contact={c} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{c.name}</span>
                    {c.title && <span className="block truncate text-xs text-muted-foreground">{c.title}</span>}
                  </span>
                </RowLink>
              </td>
              <td className={cn(TD, "text-muted-foreground")}>{c.orgs.map((o) => o.name).join(", ") || "—"}</td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{c.applicationCount}</td>
              <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
                {c.lastActivityAt ? relativeTime(c.lastActivityAt) : "—"}
              </td>
              <Chevron />
            </tr>
          ))}
        </tbody>
      </table>
      <LoadMore {...pager} />
    </div>
  );
}
