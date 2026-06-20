import { Link } from "react-router";
import { Button } from "~/components/ui/Button";
import { StatusPill } from "./OfferingCard";

interface Instructor {
  user: { id: string; firstName: string | null; lastName: string | null };
}

interface Session {
  id: string;
  sequence: number;
  datetime: string | Date;
  location: string | null;
}

export interface OfferingDetailProps {
  offering: {
    id: string;
    title: string;
    type: "Miniseries" | "Workshop";
    capacity: number;
    startsAt: string | Date;
    endsAt: string | Date;
    registrationOpensAt: string | Date;
    registrationClosesAt: string | Date;
    requiresReview: boolean;
    instructors: Instructor[];
    sessions: Session[];
  };
  approvedCount: number;
  myStatus: "Submitted" | "Approved" | "Waitlisted" | "Rejected" | "Withdrawn" | null;
  applyHref: string;
  enrolledHref: string;
}

export function OfferingDetail({ offering, approvedCount, myStatus, applyHref, enrolledHref }: OfferingDetailProps) {
  const remaining = Math.max(0, offering.capacity - approvedCount);
  const now = new Date();
  const opens = new Date(offering.registrationOpensAt);
  const closes = new Date(offering.registrationClosesAt);
  const open = now >= opens && now <= closes;

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
            offering.type === "Miniseries" ? "bg-accent-teal/15 text-accent-teal" : "bg-accent-coral/15 text-accent-coral"
          }`}>
            {offering.type}
          </span>
          {myStatus && <StatusPill status={myStatus} />}
        </div>
        <h1 className="font-heading text-2xl font-bold text-dark-blue mb-2">{offering.title}</h1>
        <p className="text-sm text-muted-foreground">
          {formatRange(offering.startsAt, offering.endsAt)} · led by{" "}
          {offering.instructors.length === 0
            ? "TBA"
            : offering.instructors
                .map((i) => `${i.user.firstName ?? ""} ${i.user.lastName ?? ""}`.trim())
                .filter(Boolean)
                .join(", ")}
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-5 mb-6">
        <h2 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider mb-3">
          {offering.type === "Workshop" ? "Session" : "Schedule"}
        </h2>
        {offering.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Session details coming soon.</p>
        ) : (
          <ol className="space-y-2">
            {offering.sessions.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between text-sm">
                <span className="text-dark-blue font-medium">
                  Session {s.sequence}: {formatDateTime(s.datetime)}
                </span>
                <span className="text-muted-foreground text-xs">{s.location ?? ""}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 mb-6">
        <h2 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider mb-2">
          Registration
        </h2>
        <p className="text-sm text-muted-foreground mb-2">
          Capacity: <span className="font-semibold text-dark-blue">{offering.capacity}</span>
          {remaining === 0 ? " — full, waitlist available" : ` · ${remaining} spot${remaining === 1 ? "" : "s"} remaining`}
        </p>
        <p className="text-xs text-muted-foreground">
          Opens {opens.toLocaleString()} · Closes {closes.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {offering.requiresReview
            ? "Instructor reviews applications and decides."
            : "Auto-approved if a spot is open, otherwise placed on the waitlist."}
        </p>
      </section>

      <div className="flex items-center gap-3">
        {myStatus === "Approved" ? (
          <Link to={enrolledHref} className="inline-block">
            <Button variant="primary">View enrolled page</Button>
          </Link>
        ) : myStatus === "Waitlisted" ? (
          <span className="text-sm text-yellow-800">You're on the waitlist — we'll email you if a spot opens.</span>
        ) : myStatus === "Withdrawn" || myStatus === "Rejected" ? (
          <span className="text-sm text-muted-foreground">Application closed.</span>
        ) : open ? (
          <Link to={applyHref}>
            <Button variant="primary">{offering.requiresReview ? "Apply" : "RSVP"}</Button>
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">
            {now < opens ? "Registration not open yet." : "Registration has closed."}
          </span>
        )}
      </div>
    </div>
  );
}

function formatRange(a: string | Date, b: string | Date): string {
  const start = new Date(a);
  const end = new Date(b);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatDateTime(d: string | Date): string {
  return new Date(d).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
