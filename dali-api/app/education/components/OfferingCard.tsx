import { Link } from "react-router";

export interface OfferingCardProps {
  id: string;
  title: string;
  type: "Miniseries" | "Workshop";
  startsAt: string;
  endsAt: string;
  capacity: number;
  approvedCount: number;
  registrationClosesAt: string;
  enrolledStatus?: "Submitted" | "Approved" | "Waitlisted" | "Rejected" | "Withdrawn" | null;
  hrefPrefix: string; // e.g. "/education/offerings" or "/portal/education"
}

export function OfferingCard(props: OfferingCardProps) {
  const remaining = Math.max(0, props.capacity - props.approvedCount);
  const full = remaining === 0;
  const start = new Date(props.startsAt);
  const end = new Date(props.endsAt);
  return (
    <Link
      to={`${props.hrefPrefix}/${props.id}`}
      className="block rounded-2xl border border-border bg-card p-5 hover:shadow-brand-2 transition"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-heading text-base font-bold text-dark-blue">{props.title}</h3>
        <TypeChip type={props.type} />
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {formatDateRange(start, end)}
      </p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {full ? "Full — waitlist open" : `${remaining} / ${props.capacity} spots left`}
        </span>
        {props.enrolledStatus && <StatusPill status={props.enrolledStatus} />}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        Registration closes {new Date(props.registrationClosesAt).toLocaleDateString()}
      </p>
    </Link>
  );
}

function TypeChip({ type }: { type: "Miniseries" | "Workshop" }) {
  const isMs = type === "Miniseries";
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
        isMs ? "bg-accent-teal/15 text-accent-teal" : "bg-accent-coral/15 text-accent-coral"
      }`}
    >
      {type}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Submitted: "bg-blue-100 text-blue-700",
    Approved: "bg-green-100 text-green-700",
    Waitlisted: "bg-yellow-100 text-yellow-800",
    Rejected: "bg-red-100 text-red-700",
    Withdrawn: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${styles[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function formatDateRange(a: Date, b: Date): string {
  const sameDay = a.toDateString() === b.toDateString();
  if (sameDay) {
    return `${a.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${a.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${b.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return `${a.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${b.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}
