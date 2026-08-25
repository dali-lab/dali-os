import { Link } from "react-router";
import { Card } from "~/components/ui/Card";
import { Avatar } from "~/components/ui/Avatar";
import { cn } from "~/lib/cn";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { APPLICATION_TZ } from "~/lib/timezone";
import { Menu } from "~/components/ui/floating";
import {
  MoreHorizontal,
  Copy,
  Archive,
  ArchiveRestore,
  Trash2,
  Folder,
} from "lucide-react";

export type OfferingCardData = {
  id: string;
  type: "Miniseries" | "Workshop";
  title: string;
  status: "Draft" | "Published" | "Archived";
  capacity: number;
  requiresReview: boolean;
  registrationOpensAt: string | Date;
  registrationClosesAt: string | Date;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  sessionCount: number;
  instructorNames: string[];
  instructors: { userId: string; name: string; photoUrl: string | null }[];
  approvedCount: number;
};

export function TypeBadge({ type }: { type: OfferingCardData["type"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        type === "Miniseries"
          ? "bg-accent-teal/10 text-accent-teal"
          : "bg-accent-coral/10 text-accent-coral",
      )}
    >
      {type}
    </span>
  );
}

export function StatusBadge({ status }: { status: OfferingCardData["status"] }) {
  const styles: Record<OfferingCardData["status"], string> = {
    Draft: "bg-muted text-muted-foreground",
    Published: "bg-green-100 text-green-800",
    Archived: "bg-accent-yellow/25 text-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}

const MY_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  Submitted: { label: "Applied", className: "bg-accent-teal/10 text-accent-teal" },
  Approved: { label: "Enrolled", className: "bg-green-100 text-green-800" },
  Waitlisted: { label: "Waitlisted", className: "bg-accent-yellow/25 text-foreground" },
  Rejected: { label: "Not accepted", className: "bg-muted text-muted-foreground" },
  Withdrawn: { label: "Withdrawn", className: "bg-muted text-muted-foreground" },
};

export function MyStatusChip({ status }: { status: string | null }) {
  if (!status) return null;
  const style = MY_STATUS_STYLES[status];
  if (!style) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}

export function registrationWindowLabel(
  o: {
    registrationOpensAt: string | Date;
    registrationClosesAt: string | Date;
  },
  tz: string = APPLICATION_TZ,
): string {
  const now = new Date();
  const opens = new Date(o.registrationOpensAt);
  const closes = new Date(o.registrationClosesAt);
  if (now < opens) return `Registration opens ${formatDateShort(opens, tz)}`;
  if (now > closes) return "Registration closed";
  return `Registration open until ${formatDateShort(closes, tz)}`;
}

export function OfferingCard({
  offering,
  to,
  myStatus,
  showStatus = false,
  pendingCount,
  openAssignments,
  isCore = false,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  offering: OfferingCardData;
  to: string;
  myStatus?: string | null;
  showStatus?: boolean;
  pendingCount?: number;
  openAssignments?: number;
  /** Whether the current user is Core — gates the ⋯ menu. */
  isCore?: boolean;
  /** Called when Duplicate is picked from the menu. */
  onDuplicate?: () => void;
  /** Called when Archive / Unarchive is picked. */
  onArchive?: () => void;
  /** Called when Delete draft is picked (Draft-only). */
  onDelete?: () => void;
}) {
  const tz = useUserTimeZone();
  const seatsLeft = Math.max(0, offering.capacity - offering.approvedCount);
  const showMenu = isCore && (onDuplicate || onArchive || onDelete);

  return (
    <div className="relative group">
      <Link to={to} className="block">
        <Card className="p-4 h-full group-hover:shadow-brand-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <TypeBadge type={offering.type} />
              {showStatus && <StatusBadge status={offering.status} />}
              {myStatus !== undefined && <MyStatusChip status={myStatus} />}
              {openAssignments != null && openAssignments > 0 && (
                <span className="inline-flex items-center rounded-full bg-accent-coral text-white px-2 py-0.5 text-[11px] font-semibold">
                  {openAssignments} assignment{openAssignments === 1 ? "" : "s"} due
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {pendingCount != null && pendingCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-accent-teal/10 text-accent-teal px-2 py-0.5 text-[11px] font-semibold">
                  {pendingCount} to review
                </span>
              )}
              {showMenu && (
                // Stop the click from navigating the card link.
                <span
                  onClick={(e) => e.preventDefault()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") e.preventDefault();
                  }}
                >
                  <Menu
                    trigger={
                      <button
                        type="button"
                        aria-label="Offering options"
                        className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    }
                    align="right"
                  >
                    {onDuplicate && (
                      <Menu.Item
                        icon={<Copy className="h-3.5 w-3.5" />}
                        onSelect={onDuplicate}
                      >
                        Duplicate
                      </Menu.Item>
                    )}
                    {onArchive && (
                      <Menu.Item
                        icon={
                          offering.status === "Archived" ? (
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )
                        }
                        onSelect={onArchive}
                      >
                        {offering.status === "Archived" ? "Unarchive" : "Archive"}
                      </Menu.Item>
                    )}
                    <Menu.LinkItem
                      to={`/drive?scope=education&folder=${offering.id}`}
                      icon={<Folder className="h-3.5 w-3.5" />}
                    >
                      Open Drive folder
                    </Menu.LinkItem>
                    {onDelete && offering.status === "Draft" && (
                      <>
                        <Menu.Separator />
                        <Menu.Item
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          onSelect={onDelete}
                          destructive
                        >
                          Delete draft
                        </Menu.Item>
                      </>
                    )}
                  </Menu>
                </span>
              )}
            </div>
          </div>
          <h3 className="mt-2 font-heading font-bold text-foreground group-hover:text-accent-coral transition-colors">
            {offering.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {offering.startsAt && offering.endsAt
              ? `${formatDateShort(offering.startsAt, tz)} – ${formatDateShort(offering.endsAt, tz)}`
              : "Sessions TBD"}
            {" · "}
            {offering.sessionCount} session{offering.sessionCount === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {registrationWindowLabel(offering, tz)}
            {" · "}
            {seatsLeft > 0 ? `${seatsLeft} of ${offering.capacity} seats left` : "Full — waitlist open"}
          </p>
          {offering.instructors.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex -space-x-1.5">
                {offering.instructors.map((i) => (
                  <Avatar
                    key={i.userId}
                    photoUrl={i.photoUrl}
                    name={i.name}
                    size="xs"
                    className="ring-2 ring-card"
                  />
                ))}
              </div>
              <p className="text-xs text-foreground">
                Taught by {offering.instructors.map((i) => i.name).join(", ")}
              </p>
            </div>
          )}
        </Card>
      </Link>
    </div>
  );
}
