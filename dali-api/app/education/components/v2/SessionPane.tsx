import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { FileText, ExternalLink } from "lucide-react";
import { cn } from "~/lib/cn";
import { formatSessionWhen, formatDateTime } from "~/lib/display";
import { Button } from "~/components/ui/Button";
import type { HubData } from "../CourseHub";

type Session = HubData["sessions"][number];
type Material = HubData["materials"][number];
type Assignment = HubData["assignments"][number];
type CourseFile = {
  id: string;
  title: string;
  folderPageId: string | null;
  href: string | null;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </h3>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground/70 italic">{children}</p>
  );
}

// Attendance chip for student
const ATTENDANCE_STYLE: Record<string, string> = {
  Present: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  Absent: "border-red-500/30 bg-red-500/10 text-red-700",
  Excused: "border-amber-500/30 bg-amber-500/10 text-amber-700",
};

function AttendanceChip({ status }: { status: "Present" | "Absent" | "Excused" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        ATTENDANCE_STYLE[status],
      )}
    >
      {status}
    </span>
  );
}

// Assignment status chip
function AssignmentStatusChip({ a, tz }: { a: Assignment; tz: string }) {
  const graded = a.myGrade != null || a.myScore != null;
  if (graded) {
    const score =
      a.myScore != null && a.points != null
        ? `${a.myScore}/${a.points}`
        : (a.myGrade ?? String(a.myScore));
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
        {score}
      </span>
    );
  }
  if (a.mySubmittedAt) {
    return (
      <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-700 px-2 py-0.5 text-[11px] font-semibold">
        Submitted
      </span>
    );
  }
  const overdue = a.dueAt != null && new Date(a.dueAt) < new Date();
  return (
    <span
      className={cn(
        "text-xs",
        overdue ? "font-medium text-red-600" : "text-muted-foreground",
      )}
    >
      {a.dueAt ? `due ${formatDateTime(a.dueAt, tz)}` : "no due date"}
    </span>
  );
}

// Check-in button (same logic as CourseHub, self-contained)
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
    return <span className="text-xs font-semibold text-accent-teal">✓ Checked in</span>;
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" onClick={checkIn} disabled={submitting}>
        {submitting ? "Checking in…" : "Check in"}
      </Button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionPane
// ---------------------------------------------------------------------------

export function SessionPane({
  session,
  materials,
  files,
  assignments,
  basePath,
  tz,
  isManager,
  extras,
}: {
  session: Session;
  materials: Material[];
  files: CourseFile[];
  assignments: Assignment[];
  basePath: string;
  tz: string;
  isManager: boolean;
  extras?: ReactNode;
}) {
  // Flat leaves tagged to this session
  const sessionMaterials = materials.flatMap((m) => {
    const matches: { id: string; title: string }[] = [];
    if (!m.isFolder && m.sessionId === session.id) {
      matches.push({ id: m.id, title: m.title });
    }
    m.children.forEach((c) => {
      if (c.sessionId === session.id) matches.push({ id: c.id, title: c.title });
    });
    return matches;
  });

  const sessionFiles = files.filter((f) => {
    // Files don't have a sessionId directly; we associate by folderPageId only
    // if there's no better grouping — for now show all files without folderPageId
    // in the Library tab. Here, show nothing (files appear in Library).
    return false;
  });

  const sessionAssignments = assignments.filter(
    (a) => a.sessionSequence === session.sequence,
  );

  const hasContent =
    sessionMaterials.length > 0 ||
    session.recordingUrl ||
    sessionAssignments.length > 0 ||
    session.notes;

  const canCheckIn =
    !isManager && session.checkInOpen && !session.myAttendance;

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-lg font-bold text-foreground">
            Session {session.sequence}
            {session.title ? ` · ${session.title}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatSessionWhen(session.datetime, session.endsAt, tz)}
            {session.location ? ` · ${session.location}` : ""}
          </p>
        </div>

        {/* Student: attendance chip or check-in */}
        {!isManager && (
          <div className="shrink-0">
            {session.myAttendance ? (
              <AttendanceChip status={session.myAttendance} />
            ) : canCheckIn ? (
              <SessionCheckInButton sessionId={session.id} initialPresent={false} />
            ) : null}
          </div>
        )}
      </div>

      {/* Prep notes */}
      {session.notes && (
        <div>
          <SectionHeading>Prep</SectionHeading>
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {session.notes}
          </p>
        </div>
      )}

      {/* Materials */}
      <div>
        <SectionHeading>Materials</SectionHeading>
        {sessionMaterials.length === 0 ? (
          <EmptyNote>No materials for this session.</EmptyNote>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sessionMaterials.map((m) => (
              <Link
                key={m.id}
                to={`${basePath}/page/${m.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground hover:border-accent-coral/50 hover:text-accent-coral transition-colors"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {m.title}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recording */}
      {session.recordingUrl && (
        <div>
          <SectionHeading>Recording</SectionHeading>
          <a
            href={session.recordingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-accent-teal/30 bg-accent-teal/10 px-3 py-1 text-sm font-medium text-accent-teal hover:bg-accent-teal/20 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Watch recording
          </a>
        </div>
      )}

      {/* Assignments */}
      {sessionAssignments.length > 0 && (
        <div>
          <SectionHeading>Assignments</SectionHeading>
          <div className="flex flex-col gap-2">
            {sessionAssignments.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5"
              >
                <Link
                  to={`${basePath}/assignments/${a.id}`}
                  className="text-sm font-medium text-foreground hover:text-accent-coral min-w-0 truncate"
                >
                  {a.title}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <AssignmentStatusChip a={a} tz={tz} />
                  <Link
                    to={`${basePath}/assignments/${a.id}`}
                    className="text-xs font-semibold text-accent-coral hover:underline"
                  >
                    Open →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasContent && (
        <EmptyNote>No content for this session yet.</EmptyNote>
      )}

      {/* Extras slot for the instructor workstream */}
      {extras && <div>{extras}</div>}
    </div>
  );
}
