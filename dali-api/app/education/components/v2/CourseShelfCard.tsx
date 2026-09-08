import { Link } from "react-router";
import { cn } from "~/lib/cn";
import { formatDateShort, formatTimeOnly } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

// Soft brand-tint card washes — deterministic by index mod 4.
const CARD_WASHES = [
  "bg-accent-coral/8",
  "bg-accent-teal/8",
  "bg-accent-yellow/10",
  "bg-accent-pink/8",
] as const;

type SessionDot = { id: string; datetime: Date; present: boolean };

type CourseEntry = {
  offeringId: string;
  title: string;
  type: string;
  attended: number;
  total: number;
  nextSessionAt: Date | null;
  isPast: boolean;
  sessionDots: SessionDot[];
  openDueCount: number;
  soonestDueAt: Date | null;
  certificateId: string | null;
};

type OpenCheckIn = {
  sessionId: string;
  offeringTitle: string;
  sessionLabel: string;
  datetime: Date;
  endsAt: Date | null;
};

/**
 * A dot representing one session on the shelf card — filled teal = present,
 * hollow with border = not yet attended.
 */
function SessionDotMark({ present }: { present: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full flex-shrink-0",
        present
          ? "bg-accent-teal"
          : "border border-muted-foreground/40 bg-transparent",
      )}
    />
  );
}

function formatNextSession(date: Date, tz: string): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const dayMs = 86_400_000;

  if (diff < dayMs && diff >= 0) return `Today ${formatTimeOnly(date, tz)}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    formatDateShort(date, tz) === formatDateShort(tomorrow, tz)
  )
    return `Tomorrow ${formatTimeOnly(date, tz)}`;

  // Within the next 6 days → "Tue 7pm"
  if (diff < 6 * dayMs) {
    const day = date.toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: tz,
    });
    return `${day} ${formatTimeOnly(date, tz)}`;
  }
  return `Next ${date.toLocaleDateString("en-US", { weekday: "short", timeZone: tz })} ${formatTimeOnly(date, tz)}`;
}

function formatDueLabel(date: Date, tz: string): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const dayMs = 86_400_000;
  if (diff < dayMs && diff >= 0) return "today";
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (formatDateShort(date, tz) === formatDateShort(tomorrow, tz)) return "tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
}

/**
 * Shelf card for an enrolled course. `checkIn` is truthy when this course has
 * an open check-in right now — shows a prominent teal CTA.
 */
export function CourseShelfCard({
  course,
  checkIn,
  basePath,
  index,
}: {
  course: CourseEntry;
  checkIn: OpenCheckIn | undefined;
  basePath: string;
  index: number;
}) {
  const tz = useUserTimeZone();
  const wash = CARD_WASHES[index % CARD_WASHES.length]!;

  return (
    <Link
      to={`${basePath}/${course.offeringId}/hub`}
      className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal rounded-2xl"
    >
      <div
        className={cn(
          "relative rounded-2xl border border-border p-4 h-full flex flex-col gap-3 transition-shadow group-hover:shadow-brand-2",
          wash,
        )}
      >
        {/* Type badge */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
              course.type === "Miniseries"
                ? "bg-accent-teal/15 text-accent-teal"
                : "bg-accent-coral/15 text-accent-coral",
            )}
          >
            {course.type}
          </span>
          {course.isPast && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-muted text-muted-foreground">
              Past
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-heading font-bold text-foreground text-sm leading-snug group-hover:text-accent-coral transition-colors">
          {course.title}
        </h3>

        {/* Session dots */}
        {course.sessionDots.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {course.sessionDots.map((dot) => (
              <SessionDotMark key={dot.id} present={dot.present} />
            ))}
          </div>
        )}

        {/* Status line */}
        <div className="mt-auto text-xs text-muted-foreground">
          {checkIn ? null : course.isPast ? (
            course.certificateId ? (
              <Link
                to={`/education/certificates/${course.certificateId}`}
                onClick={(e) => e.stopPropagation()}
                className="text-accent-coral font-semibold hover:underline"
              >
                Finished · cert ready
              </Link>
            ) : (
              <span>
                {course.attended}/{course.total} sessions attended
              </span>
            )
          ) : course.openDueCount > 0 && course.soonestDueAt ? (
            <span className="text-amber-700 font-medium">
              {course.openDueCount} due {formatDueLabel(new Date(course.soonestDueAt), tz)}
            </span>
          ) : course.nextSessionAt ? (
            // formatNextSession already includes the "Next"/"Tonight" framing.
            <span>{formatNextSession(new Date(course.nextSessionAt), tz)}</span>
          ) : (
            <span>
              {course.attended}/{course.total} attended
            </span>
          )}
        </div>

        {/* Check-in CTA — overlays the status line when open */}
        {checkIn && (
          <Link
            to={`/education/check-in/${checkIn.sessionId}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "mt-auto inline-flex items-center justify-center gap-1.5 rounded-full",
              "bg-accent-teal text-white text-xs font-semibold px-3 py-1.5",
              "hover:bg-accent-teal/90 transition-colors",
            )}
          >
            ✓ Check in
          </Link>
        )}
      </div>
    </Link>
  );
}
