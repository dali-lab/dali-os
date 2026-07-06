import { Link } from "react-router";
import { Card } from "~/components/ui/Card";
import { cn } from "~/lib/cn";
import { formatDateShort } from "~/lib/display";

export type OfferingCardData = {
  id: string;
  type: "Miniseries" | "Workshop";
  title: string;
  status: "Draft" | "Published" | "Archived";
  capacity: number;
  requiresReview: boolean;
  registrationOpensAt: string | Date;
  registrationClosesAt: string | Date;
  startsAt: string | Date;
  endsAt: string | Date;
  sessionCount: number;
  instructorNames: string[];
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
    Archived: "bg-amber-100 text-amber-800",
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
  Submitted: { label: "Applied", className: "bg-blue-100 text-blue-800" },
  Approved: { label: "Enrolled", className: "bg-green-100 text-green-800" },
  Waitlisted: { label: "Waitlisted", className: "bg-amber-100 text-amber-800" },
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

export function registrationWindowLabel(o: {
  registrationOpensAt: string | Date;
  registrationClosesAt: string | Date;
}): string {
  const now = new Date();
  const opens = new Date(o.registrationOpensAt);
  const closes = new Date(o.registrationClosesAt);
  if (now < opens) return `Registration opens ${formatDateShort(opens)}`;
  if (now > closes) return "Registration closed";
  return `Registration open until ${formatDateShort(closes)}`;
}

export function OfferingCard({
  offering,
  to,
  myStatus,
  showStatus = false,
  pendingCount,
  openAssignments,
}: {
  offering: OfferingCardData;
  to: string;
  myStatus?: string | null;
  showStatus?: boolean;
  pendingCount?: number;
  openAssignments?: number;
}) {
  const seatsLeft = Math.max(0, offering.capacity - offering.approvedCount);
  return (
    <Link to={to} className="block group">
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
          {pendingCount != null && pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[11px] font-semibold">
              {pendingCount} to review
            </span>
          )}
        </div>
        <h3 className="mt-2 font-heading font-bold text-foreground group-hover:text-accent-coral transition-colors">
          {offering.title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateShort(offering.startsAt)} – {formatDateShort(offering.endsAt)}
          {" · "}
          {offering.sessionCount} session{offering.sessionCount === 1 ? "" : "s"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {registrationWindowLabel(offering)}
          {" · "}
          {seatsLeft > 0 ? `${seatsLeft} of ${offering.capacity} seats left` : "Full — waitlist open"}
        </p>
        {offering.instructorNames.length > 0 && (
          <p className="mt-2 text-xs text-foreground">
            Taught by {offering.instructorNames.join(", ")}
          </p>
        )}
      </Card>
    </Link>
  );
}
