import { Link } from "react-router";
import { Avatar } from "~/components/ui/Avatar";
import { cn } from "~/lib/cn";
import { Pill, type PillTone } from "~/hiring/components/cycle-setup/SetupCard";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { APPLICATION_TZ } from "~/lib/timezone";
import type { MetaTone } from "~/components/ui/MetaList";
import { Menu, Tooltip } from "~/components/ui/floating";
import {
  MoreHorizontal,
  Copy,
  Archive,
  ArchiveRestore,
  Trash2,
  Folder,
} from "lucide-react";
import {
  OFFERING_TYPE_DESCRIPTIONS,
  type OfferingType,
} from "~/education/lib/offering-type";

export type OfferingCardData = {
  id: string;
  type: OfferingType;
  title: string;
  iconEmoji?: string | null;
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
  const tip = OFFERING_TYPE_DESCRIPTIONS[type];
  return (
    <Tooltip content={tip} variant="rich" placement="top">
      <span className="inline-flex">
        <Pill outline>{type}</Pill>
      </span>
    </Tooltip>
  );
}

const STATUS_TIPS: Record<OfferingCardData["status"], string> = {
  Draft: "Not yet visible to members. Publish to open registration.",
  Published: "Visible to members and accepting applications within the registration window.",
  Archived: "Hidden from the hub and closed to new applications. Existing enrollments are preserved.",
};

export function StatusBadge({ status }: { status: OfferingCardData["status"] }) {
  const styles: Record<OfferingCardData["status"], string> = {
    Draft: "bg-muted text-muted-foreground",
    Published: "bg-os-green/15 text-os-green",
    Archived: "bg-accent-yellow/25 text-foreground",
  };
  return (
    <Tooltip content={STATUS_TIPS[status]} variant="rich" placement="top">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
          styles[status],
        )}
      >
        {status}
      </span>
    </Tooltip>
  );
}

const MY_STATUS_STYLES: Record<string, { label: string; dot: PillTone }> = {
  Submitted: { label: "Applied", dot: "accent" },
  Approved: { label: "Enrolled", dot: "success" },
  Waitlisted: { label: "Waitlisted", dot: "warning" },
  Rejected: { label: "Not accepted", dot: "danger" },
  Withdrawn: { label: "Withdrawn", dot: "neutral" },
};

const MY_STATUS_TIPS: Record<string, string | null> = {
  Waitlisted:
    "You're on the waitlist. If a seat opens before registration closes, you'll be automatically moved to Enrolled (you'll get a notification).",
  Submitted: null,
  Approved: null,
  Rejected: null,
  Withdrawn: null,
};

export function MyStatusChip({ status }: { status: string | null }) {
  if (!status) return null;
  const style = MY_STATUS_STYLES[status];
  if (!style) return null;
  const tip = MY_STATUS_TIPS[status] ?? null;
  return (
    <Tooltip content={tip} variant="rich" placement="top">
      <span className="inline-flex">
        <Pill outline dot={style.dot}>
          {style.label}
        </Pill>
      </span>
    </Tooltip>
  );
}

// The registration window on its own, for callers that already label the field
// ("Registration: open until Mar 3"). Prefixing it there would stutter.
export function registrationWindowValue(
  o: {
    registrationOpensAt: string | Date;
    registrationClosesAt: string | Date;
  },
  tz: string = APPLICATION_TZ,
): string {
  const now = new Date();
  const opens = new Date(o.registrationOpensAt);
  const closes = new Date(o.registrationClosesAt);
  if (now < opens) return `Opens ${formatDateShort(opens, tz)}`;
  if (now > closes) return "Closed";
  return `Open until ${formatDateShort(closes, tz)}`;
}

// The registration window as a labelled meta row with urgency baked in: a
// window closing within a week reads "Closes in N days" in coral so a browser
// notices the deadline, one not yet open or already closed stays muted, and an
// open-with-runway window keeps the plain "Open until …".
export function registrationMeta(
  o: {
    registrationOpensAt: string | Date;
    registrationClosesAt: string | Date;
  },
  tz: string = APPLICATION_TZ,
): { value: string; tone: MetaTone } {
  const now = Date.now();
  const opens = new Date(o.registrationOpensAt).getTime();
  const closes = new Date(o.registrationClosesAt).getTime();
  if (now < opens) return { value: registrationWindowValue(o, tz), tone: "muted" };
  if (now > closes) return { value: "Closed", tone: "muted" };
  const daysLeft = Math.ceil((closes - now) / 86_400_000);
  if (daysLeft <= 7) {
    return {
      value: daysLeft <= 1 ? "Closes soon" : `Closes in ${daysLeft} days`,
      tone: "urgent",
    };
  }
  return { value: registrationWindowValue(o, tz), tone: "default" };
}

// The same window as a standalone sentence, for prose contexts (the offering
// detail pages, the admin card) that carry no separate field label.
export function registrationWindowLabel(
  o: {
    registrationOpensAt: string | Date;
    registrationClosesAt: string | Date;
  },
  tz: string = APPLICATION_TZ,
): string {
  const value = registrationWindowValue(o, tz);
  return `Registration ${value.charAt(0).toLowerCase()}${value.slice(1)}`;
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
        <div className="h-full rounded-os-card bg-os-card p-5 transition-colors group-hover:bg-os-card-hover">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <TypeBadge type={offering.type} />
              {showStatus && <StatusBadge status={offering.status} />}
              {myStatus !== undefined && <MyStatusChip status={myStatus} />}
              {openAssignments != null && openAssignments > 0 && (
                <span className="inline-flex items-center rounded-full border border-os-container px-3 py-1 text-sm font-medium text-os-grey">
                  {openAssignments} assignment{openAssignments === 1 ? "" : "s"} due
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {pendingCount != null && pendingCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-os-accent/10 text-os-accent px-2 py-0.5 text-[11px] font-semibold">
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
          <h3 className="mt-3 font-heading text-lg font-semibold text-foreground">
            {offering.title}
          </h3>
          <p className="mt-1 text-sm text-os-grey">
            {offering.startsAt && offering.endsAt
              ? `${formatDateShort(offering.startsAt, tz)} – ${formatDateShort(offering.endsAt, tz)}`
              : "Sessions TBD"}
            {" · "}
            {offering.sessionCount} session{offering.sessionCount === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-sm text-os-grey">
            {registrationWindowLabel(offering, tz)}
            {" · "}
            {seatsLeft > 0 ? `${seatsLeft} of ${offering.capacity} seats left` : "Full — waitlist open"}
          </p>
          {offering.instructors.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
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
        </div>
      </Link>
    </div>
  );
}
