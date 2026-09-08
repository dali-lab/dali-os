import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/cn";
import { formatSessionWhen } from "~/lib/display";
import { Button } from "~/components/ui/Button";

// ---------------------------------------------------------------------------
// Public contract — the instructor workstream builds on this interface.
// ---------------------------------------------------------------------------

export type JourneyStop = {
  id: string;
  sequence: number;
  title: string | null;
  datetime: string | Date;
  endsAt: string | Date | null;
  location: string | null;
  myAttendance: "Present" | "Absent" | "Excused" | null;
  checkInOpen: boolean;
  hasMaterials: boolean;
  hasAssignments: boolean;
  hasRecording: boolean;
};

export type CertificateNode =
  | { kind: "unlocked"; certificateId: string }
  | { kind: "onTrack" }
  | { kind: "needsMore"; sessionsNeeded: number }
  | null;

type Props = {
  stops: JourneyStop[];
  certificate: CertificateNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  lens: "student" | "editor";
  tz: string;
  renderStopExtras?: (stop: JourneyStop) => ReactNode;
  trailing?: ReactNode;
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInProgress(stop: JourneyStop): boolean {
  const now = Date.now();
  const start = new Date(stop.datetime).getTime();
  const end = stop.endsAt ? new Date(stop.endsAt).getTime() : start;
  return now >= start && now <= end;
}

function isFuture(stop: JourneyStop): boolean {
  const start = new Date(stop.datetime).getTime();
  return Date.now() < start;
}

function isPast(stop: JourneyStop): boolean {
  const end = stop.endsAt ? new Date(stop.endsAt).getTime() : new Date(stop.datetime).getTime();
  return Date.now() > end && !isInProgress(stop);
}

function findCurrentStop(stops: JourneyStop[]): JourneyStop | null {
  // First: any in-progress stop.
  const inProgress = stops.find(isInProgress);
  if (inProgress) return inProgress;
  // Else: earliest future stop.
  const future = stops.filter(isFuture).sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
  );
  return future[0] ?? null;
}

// ---------------------------------------------------------------------------
// Attendance glyph for past tiles (student lens)
// ---------------------------------------------------------------------------

function AttendanceGlyph({
  attendance,
}: {
  attendance: "Present" | "Absent" | "Excused" | null;
}) {
  if (attendance === "Present") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-teal text-white text-[10px] font-bold leading-none">
        ✓
      </span>
    );
  }
  if (attendance === "Excused") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 text-[10px] font-bold leading-none border border-amber-300/60">
        E
      </span>
    );
  }
  if (attendance === "Absent") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px] font-bold leading-none">
        ✗
      </span>
    );
  }
  // Unmarked
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground text-[10px]" />
  );
}

// ---------------------------------------------------------------------------
// SessionCheckInButton (copied from CourseHub to keep it self-contained
// and avoid import cycles — logic is identical)
// ---------------------------------------------------------------------------

function SessionCheckInButton({
  sessionId,
  initialPresent,
}: {
  sessionId: string;
  initialPresent: boolean;
}) {
  const [present, setPresent] = useState(initialPresent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/education/sessions/${sessionId}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError((j as { error?: string } | null)?.error ?? "Check-in failed");
        return;
      }
      setPresent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (present) {
    return (
      <span className="text-xs font-semibold text-accent-teal">✓ Checked in</span>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        onClick={checkIn}
        disabled={submitting}
        className="bg-accent-teal text-white hover:bg-accent-teal/90 border-0"
      >
        {submitting ? "Checking in…" : "Check in"}
      </Button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Current stop — the large hero card
// ---------------------------------------------------------------------------

function CurrentStopCard({
  stop,
  selected,
  tz,
  lens,
  onSelect,
  renderStopExtras,
}: {
  stop: JourneyStop;
  selected: boolean;
  tz: string;
  lens: "student" | "editor";
  onSelect: (id: string) => void;
  renderStopExtras?: (stop: JourneyStop) => ReactNode;
}) {
  const alreadyAttended = stop.myAttendance === "Present";
  const canCheckIn = lens === "student" && stop.checkInOpen && !alreadyAttended;

  return (
    // Not a <button>: the card hosts nested interactive controls (check-in,
    // Show QR) and nested buttons are invalid HTML — they break hydration.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(stop.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(stop.id);
        }
      }}
      className={cn(
        "shrink-0 w-56 rounded-2xl p-4 text-left transition-all cursor-pointer",
        "bg-accent-coral/15 border border-accent-coral/30",
        "shadow-lg",
        selected && "ring-2 ring-dark-blue/30",
      )}
      aria-current="true"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
        Session {stop.sequence}
      </p>
      <p className="font-heading text-base font-bold text-foreground leading-snug line-clamp-2">
        {stop.title ?? `Session ${stop.sequence}`}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatSessionWhen(stop.datetime, stop.endsAt, tz)}
      </p>
      {stop.location && (
        <p className="mt-0.5 text-xs text-muted-foreground truncate">{stop.location}</p>
      )}

      {/* Meta line */}
      {(stop.hasMaterials || stop.hasAssignments) && (
        <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {stop.hasMaterials && <span>📄 Materials</span>}
          {stop.hasAssignments && <span>📝 Assignment</span>}
        </p>
      )}

      {/* Student attendance / check-in */}
      {lens === "student" && (
        <div className="mt-3">
          {alreadyAttended ? (
            <span className="text-xs font-semibold text-accent-teal">✓ Checked in</span>
          ) : canCheckIn ? (
            <SessionCheckInButton sessionId={stop.id} initialPresent={false} />
          ) : stop.myAttendance === "Excused" ? (
            <span className="text-xs font-semibold text-amber-600">Excused</span>
          ) : null}
        </div>
      )}

      {renderStopExtras && (
        <div className="mt-2">{renderStopExtras(stop)}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Past stub tile (single stop)
// ---------------------------------------------------------------------------

function PastTile({
  stop,
  selected,
  lens,
  onSelect,
}: {
  stop: JourneyStop;
  selected: boolean;
  lens: "student" | "editor";
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(stop.id)}
      className={cn(
        "shrink-0 flex flex-col items-center justify-center gap-1 w-16 h-16 rounded-2xl border transition-colors",
        "border-border bg-card hover:bg-muted/40",
        selected && "ring-2 ring-dark-blue/30 bg-muted/40",
      )}
      title={stop.title ?? `Session ${stop.sequence}`}
    >
      <span className="text-[10px] font-semibold text-muted-foreground">S{stop.sequence}</span>
      {lens === "student" && (
        <AttendanceGlyph attendance={stop.myAttendance} />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Collapsed stub "N done"
// ---------------------------------------------------------------------------

function CollapsedStub({
  count,
  attendedCount,
  lens,
  onExpand,
}: {
  count: number;
  attendedCount: number;
  lens: "student" | "editor";
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="shrink-0 flex flex-col items-center justify-center gap-0.5 w-16 h-16 rounded-2xl border-2 border-dashed border-border text-muted-foreground hover:border-dark-blue/30 hover:text-foreground transition-colors"
      title="Expand past sessions"
    >
      <span className="text-[11px] font-semibold">{count} done</span>
      {lens === "student" && (
        <span className="text-[10px] text-muted-foreground">{attendedCount} attended</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Future tile
// ---------------------------------------------------------------------------

function FutureTile({
  stop,
  selected,
  onSelect,
}: {
  stop: JourneyStop;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(stop.id)}
      className={cn(
        "shrink-0 flex flex-col items-center justify-center gap-1 w-16 h-16 rounded-2xl border-2 border-dashed transition-colors",
        "border-border text-muted-foreground hover:border-dark-blue/30 hover:text-foreground",
        selected && "ring-2 ring-dark-blue/30 border-dark-blue/30 text-foreground",
      )}
      title={stop.title ?? `Session ${stop.sequence}`}
    >
      <span className="text-[10px] font-semibold">S{stop.sequence}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Certificate node
// ---------------------------------------------------------------------------

function CertNode({ certificate }: { certificate: NonNullable<CertificateNode> }) {
  if (certificate.kind === "unlocked") {
    return (
      <Link
        to={`/education/certificates/${certificate.certificateId}`}
        className="shrink-0 flex flex-col items-center justify-center gap-1 w-20 h-16 rounded-2xl border border-accent-yellow/50 bg-accent-yellow/20 text-foreground hover:bg-accent-yellow/30 transition-colors"
        title="View your certificate"
      >
        <span className="text-lg leading-none">🎓</span>
        <span className="text-[10px] font-semibold text-center">Certificate ready</span>
      </Link>
    );
  }
  if (certificate.kind === "onTrack") {
    return (
      <div className="shrink-0 flex flex-col items-center justify-center gap-1 w-20 h-16 rounded-2xl border border-border text-muted-foreground">
        <span className="text-lg leading-none">🏅</span>
        <span className="text-[10px] font-semibold text-center">On track</span>
      </div>
    );
  }
  // needsMore
  return (
    <div className="shrink-0 flex flex-col items-center justify-center gap-1 w-20 h-16 rounded-2xl border border-border text-muted-foreground">
      <span className="text-[10px] font-semibold text-center leading-tight">
        {certificate.sessionsNeeded} more to earn
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer line
// ---------------------------------------------------------------------------

function FooterLine({ certificate }: { certificate: CertificateNode }) {
  if (!certificate) return null;
  if (certificate.kind === "unlocked") {
    return (
      <p className="mt-3 text-xs text-muted-foreground text-center">Certificate earned 🎉</p>
    );
  }
  if (certificate.kind === "onTrack") {
    return (
      <p className="mt-3 text-xs text-muted-foreground text-center">
        You&apos;re on track for the certificate
      </p>
    );
  }
  return (
    <p className="mt-3 text-xs text-muted-foreground text-center">
      Attend {certificate.sessionsNeeded} more session{certificate.sessionsNeeded === 1 ? "" : "s"} to unlock your certificate
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function JourneyBand({
  stops,
  certificate,
  selectedId,
  onSelect,
  lens,
  tz,
  renderStopExtras,
  trailing,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentStop = findCurrentStop(stops);
  const [expanded, setExpanded] = useState(false);

  // Scroll current stop into view on mount. Instant, not smooth: an animated
  // scroll right after load makes the band a moving click target.
  useEffect(() => {
    if (!scrollRef.current || !currentStop) return;
    const el = scrollRef.current.querySelector<HTMLElement>("[aria-current='true']");
    el?.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
  }, [currentStop?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (stops.length === 0) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <p className="text-sm text-muted-foreground italic">No sessions scheduled yet.</p>
      </div>
    );
  }

  // Partition
  const pastStops = stops.filter(isPast);
  const currentStopEl = currentStop && !isPast(currentStop) && !isFuture(currentStop)
    ? currentStop
    : currentStop && isInProgress(currentStop)
    ? currentStop
    : null;
  // If the "current" stop is actually the earliest future stop (no in-progress), treat it as current too
  const currentTileStop = currentStop ?? null;
  const futureStops = stops.filter(
    (s) => isFuture(s) && s.id !== currentTileStop?.id,
  );
  // Which stop is the "current" card (large)?
  const heroStop = currentTileStop;

  // Past stops: collapse all but the most recent if >5 total
  const COLLAPSE_THRESHOLD = 5;
  const shouldCollapse = stops.length > COLLAPSE_THRESHOLD && pastStops.length > 1;
  const mostRecentPast = pastStops[pastStops.length - 1];
  const collapsedPastStops = shouldCollapse && !expanded
    ? pastStops.slice(0, -1)
    : [];
  const visiblePastStops = shouldCollapse && !expanded
    ? [mostRecentPast].filter(Boolean)
    : pastStops;

  const collapsedCount = collapsedPastStops.length;
  const collapsedAttended = collapsedPastStops.filter(
    (s) => s.myAttendance === "Present",
  ).length;

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Scrollable tile row */}
      <div
        ref={scrollRef}
        className="flex items-center gap-3 overflow-x-auto pb-2 no-scrollbar"
      >
        {/* Collapsed past stub */}
        {shouldCollapse && !expanded && collapsedCount > 0 && (
          <CollapsedStub
            count={collapsedCount}
            attendedCount={collapsedAttended}
            lens={lens}
            onExpand={() => setExpanded(true)}
          />
        )}

        {/* Visible past tiles */}
        {visiblePastStops.map((stop) => (
          <PastTile
            key={stop.id}
            stop={stop}
            selected={selectedId === stop.id}
            lens={lens}
            onSelect={onSelect}
          />
        ))}

        {/* Current/hero stop */}
        {heroStop && (
          <CurrentStopCard
            stop={heroStop}
            selected={selectedId === heroStop.id}
            tz={tz}
            lens={lens}
            onSelect={onSelect}
            renderStopExtras={renderStopExtras}
          />
        )}

        {/* Future stops */}
        {futureStops.map((stop) => (
          <FutureTile
            key={stop.id}
            stop={stop}
            selected={selectedId === stop.id}
            onSelect={onSelect}
          />
        ))}

        {/* Certificate node */}
        {certificate && (
          <>
            <div className="shrink-0 w-px h-8 bg-border" />
            <CertNode certificate={certificate} />
          </>
        )}

        {/* Trailing slot (instructor: add-session tile) */}
        {trailing && <>{trailing}</>}
      </div>

      {/* Footer */}
      {lens === "student" && <FooterLine certificate={certificate} />}
    </div>
  );
}
