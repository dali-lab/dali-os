import type React from "react";
import { Link } from "react-router";
import { Calendar, MapPin, Users } from "lucide-react";
import { INTERVIEW_STATUS_TONES, INTERVIEW_STATUS_LABELS, RECOMMENDATION_TONES } from "~/hiring/lib/labels";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";

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
  status: string; // key into labels.INTERVIEW_STATUS_TONES
  room?: { name: string } | null;
  zoomJoinUrl?: string | null;
  videoUrl?: string | null;
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
  const statusTone = INTERVIEW_STATUS_TONES[interview.status] ?? "neutral";
  const joint = jointNotesText(interview.jointNotes);
  const interviewers = interview.interviewers ?? [];
  const interviewersWithNotes = interviewers.filter(
    (a) => a.notes != null && a.notes.trim().length > 0,
  );

  if (variant === "compact") {
    return (
      <div className="px-6 pb-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-os-grey">
            {start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
            {start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
          <Pill dot={statusTone}>{statusLabel}</Pill>
        </div>
        {interview.recommendation && (
          <div className="text-sm">
            <span className="text-os-grey">Recommendation:</span>{" "}
            <span className="font-medium text-foreground">{interview.recommendation}</span>
          </div>
        )}
        {interview.recommendationNotes && (
          <p className="text-xs text-os-grey bg-os-well rounded-os-item p-2">
            {interview.recommendationNotes}
          </p>
        )}
        {interviewers.length > 0 && (
          <div className="text-xs text-os-grey pt-1">
            Interviewers: {interviewers.map((a) => a.name).join(", ")}
          </div>
        )}

        {/* Joint interview notes (shared by both interviewers). */}
        <div className="pt-2 border-t border-os-container">
          <div className="os-field-label">
            Interview notes
          </div>
          {joint ? (
            <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{joint.text}</p>
          ) : (
            <p className="mt-1 text-xs text-os-grey/70 italic">No interview notes.</p>
          )}
        </div>

        {/* Per-interviewer recommendation notes, when present. */}
        {interviewersWithNotes.length > 0 && (
          <div className="pt-2 space-y-2">
            {interviewersWithNotes.map((a) => (
              <div key={a.id}>
                <div className="text-xs font-medium text-os-grey">
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

  return (
    <div className="px-6 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Pill dot={statusTone}>{statusLabel}</Pill>
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <Calendar className="w-3.5 h-3.5 text-os-grey" aria-hidden />
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
        <span className="inline-flex items-center gap-1.5 text-xs text-os-grey">
          <MapPin className="w-3.5 h-3.5" aria-hidden />
          {interview.room?.name ?? "Online"}
          {!interview.room && (interview.videoUrl ?? interview.zoomJoinUrl) && (
            <a
              href={interview.videoUrl ?? interview.zoomJoinUrl ?? ''}
              target="_blank"
              rel="noopener noreferrer"
              className="text-os-accent hover:text-os-accent-hover ml-1"
            >
              Join Google Meet
            </a>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-os-grey">
          <Users className="w-3.5 h-3.5" aria-hidden />
          {interviewers.length === 0
            ? "No interviewers assigned"
            : interviewers.map((a) => `${a.name} (${interviewerMetaLabel(a)})`).join(", ")}
        </span>
      </div>
      <div className="rounded-os-item bg-os-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="os-field-label">
            Joint notes
          </div>
          {interview.openInInterviewerHref && (
            <Link
              to={interview.openInInterviewerHref}
              className="text-xs text-os-accent hover:text-os-accent-hover"
            >
              Open in interviewer view
            </Link>
          )}
        </div>
        {joint ? (
          <>
            <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">{joint.text}</p>
            {joint.updatedAt != null && (
              <p className="mt-1 text-[11px] text-os-grey/80">
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
          <p className="mt-2 text-xs text-os-grey/70 italic">No notes yet.</p>
        )}
      </div>
      {(interview.recommendation || interview.recommendationNotes) && (
        <div className="rounded-os-item bg-os-card p-3">
          <div className="os-field-label">
            Joint recommendation
          </div>
          {interview.recommendation && (
            <div className="mt-2">
              <Pill dot={RECOMMENDATION_TONES[interview.recommendation] ?? "neutral"}>
                {interview.recommendation}
              </Pill>
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
          <div className="os-field-label">
            Per-interviewer notes
          </div>
          {interviewersWithNotes.map((a) => (
            <div key={a.id} className="rounded-os-item bg-os-card p-3">
              <div className="text-sm font-medium text-foreground">
                {a.name}{" "}
                <span className="text-xs font-normal text-os-grey">
                  · {interviewerNoteLabel(a)}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">{a.notes}</p>
              {a.notesUpdatedAt != null && (
                <p className="mt-1 text-[11px] text-os-grey/80">
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
