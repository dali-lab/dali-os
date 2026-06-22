import type React from "react";
import { Link } from "react-router";
import { Calendar, MapPin, Users } from "lucide-react";
import { INTERVIEW_STATUS_COLORS, INTERVIEW_STATUS_LABELS } from "~/hiring/lib/labels";

const LOCATION_LABELS: Record<string, string> = {
  PodAppa: "Pod Appa",
  PodMomo: "Pod Momo",
  Online: "Online",
};

export interface InterviewNotesInterviewer {
  id: string;
  name: string;
  role?: string; // "InDomain" | "CrossDomain" etc.
  domainName?: string;
  notes?: string | null;
  notesUpdatedAt?: string | Date | null; // shown as "Last edit" in the full layout
}

export interface InterviewNotesData {
  id: string;
  startTime: string | Date;
  endTime?: string | Date | null;
  status: string; // key into labels.INTERVIEW_STATUS_COLORS
  location?: string | null;
  zoomJoinUrl?: string | null;
  recommendation?: string | null;
  recommendationNotes?: string | null;
  // Either the rich shape (full route) or a plain string (sidebar route).
  jointNotes?: { plainText: string; updatedAt: string | Date } | string | null;
  interviewers?: InterviewNotesInterviewer[];
  openInInterviewerHref?: string; // omit to hide the link
}

function jointNotesText(
  jointNotes: InterviewNotesData["jointNotes"],
): { text: string; updatedAt: string | Date | null } | null {
  if (jointNotes == null) return null;
  if (typeof jointNotes === "string") {
    const trimmed = jointNotes.trim();
    return trimmed.length > 0 ? { text: trimmed, updatedAt: null } : null;
  }
  const trimmed = jointNotes.plainText.trim();
  return trimmed.length > 0 ? { text: trimmed, updatedAt: jointNotes.updatedAt } : null;
}

// Meta-row label: in-domain shows the domain name, cross shows just "Cross".
function interviewerMetaLabel(a: InterviewNotesInterviewer): string {
  return a.role === "InDomain" ? a.domainName ?? "In-domain" : "Cross";
}

// Per-interviewer-note label: cross also carries the domain in parens.
function interviewerNoteLabel(a: InterviewNotesInterviewer): string {
  if (a.role === "InDomain") return a.domainName ?? "In-domain";
  return a.domainName ? `Cross (${a.domainName})` : "Cross";
}

// Shared interview content for the hiring detail routes: meta row (status,
// date/time, location, interviewers), joint notes, joint recommendation, and
// per-interviewer notes. Renders the content only — wrap it in a DetailCard or
// list <li> at the call site.
//
// Two layouts via `variant`:
//   - "full"    → roomy list-item layout used by applications.$domainApplicationId.
//   - "compact" → tighter sidebar layout used by domain-lead.application.$id.
export function InterviewNotesCard({
  interview,
  variant = "full",
}: {
  interview: InterviewNotesData;
  variant?: "full" | "compact";
}): React.ReactElement {
  const start = new Date(interview.startTime);
  const end = interview.endTime != null ? new Date(interview.endTime) : null;
  const statusLabel = INTERVIEW_STATUS_LABELS[interview.status] ?? interview.status;
  const statusClass = INTERVIEW_STATUS_COLORS[interview.status] ?? "bg-muted text-foreground/80";
  const joint = jointNotesText(interview.jointNotes);
  const interviewers = interview.interviewers ?? [];
  const interviewersWithNotes = interviewers.filter(
    (a) => a.notes != null && a.notes.trim().length > 0,
  );

  if (variant === "compact") {
    return (
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
            {start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
            {statusLabel}
          </span>
        </div>
        {interview.recommendation && (
          <div className="text-sm">
            <span className="text-muted-foreground">Recommendation:</span>{" "}
            <span className="font-medium text-foreground">{interview.recommendation}</span>
          </div>
        )}
        {interview.recommendationNotes && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            {interview.recommendationNotes}
          </p>
        )}
        {interviewers.length > 0 && (
          <div className="text-xs text-muted-foreground pt-1">
            Interviewers: {interviewers.map((a) => a.name).join(", ")}
          </div>
        )}

        {/* Joint interview notes (shared by both interviewers). */}
        <div className="pt-2 border-t border-border">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Interview notes
          </div>
          {joint ? (
            <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{joint.text}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground/70 italic">No interview notes.</p>
          )}
        </div>

        {/* Per-interviewer recommendation notes, when present. */}
        {interviewersWithNotes.length > 0 && (
          <div className="pt-2 space-y-2">
            {interviewersWithNotes.map((a) => (
              <div key={a.id}>
                <div className="text-xs font-medium text-muted-foreground">
                  {a.name}&rsquo;s notes
                </div>
                <p className="mt-0.5 text-sm text-foreground whitespace-pre-wrap">{a.notes}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const locationLabel =
    interview.location != null
      ? LOCATION_LABELS[interview.location] ?? interview.location
      : null;

  return (
    <div className="px-6 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${statusClass}`}
        >
          {statusLabel}
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
          {start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          {" · "}
          {start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          {end && (
            <>
              {" – "}
              {end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </>
          )}
        </span>
        {locationLabel != null && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="w-3.5 h-3.5" aria-hidden />
            {locationLabel}
            {interview.location === "Online" && interview.zoomJoinUrl && (
              <a
                href={interview.zoomJoinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline ml-1"
              >
                link
              </a>
            )}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="w-3.5 h-3.5" aria-hidden />
          {interviewers.length === 0
            ? "No interviewers assigned"
            : interviewers.map((a) => `${a.name} (${interviewerMetaLabel(a)})`).join(", ")}
        </span>
      </div>
      <div className="rounded-md border border-border bg-background/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Joint notes
          </div>
          {interview.openInInterviewerHref && (
            <Link
              to={interview.openInInterviewerHref}
              className="text-xs text-blue-600 hover:underline"
            >
              Open in interviewer view
            </Link>
          )}
        </div>
        {joint ? (
          <>
            <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">{joint.text}</p>
            {joint.updatedAt != null && (
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                Last edit{" "}
                {new Date(joint.updatedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground/70 italic">No notes yet.</p>
        )}
      </div>
      {(interview.recommendation || interview.recommendationNotes) && (
        <div className="rounded-md border border-border bg-background/50 p-3">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Joint recommendation
          </div>
          {interview.recommendation && (
            <div className="mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-muted text-foreground/80">
                {interview.recommendation}
              </span>
            </div>
          )}
          {interview.recommendationNotes && interview.recommendationNotes.trim().length > 0 && (
            <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">
              {interview.recommendationNotes}
            </p>
          )}
        </div>
      )}
      {interviewersWithNotes.length > 0 && (
        <div className="space-y-2 pl-1">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Per-interviewer notes
          </div>
          {interviewersWithNotes.map((a) => (
            <div key={a.id} className="rounded-md border border-border bg-background/50 p-3">
              <div className="text-sm font-medium text-foreground">
                {a.name}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · {interviewerNoteLabel(a)}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">{a.notes}</p>
              {a.notesUpdatedAt != null && (
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  Last edit{" "}
                  {new Date(a.notesUpdatedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
