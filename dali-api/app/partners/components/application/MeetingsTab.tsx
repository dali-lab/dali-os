// Meetings tab, shared by PartnerApplicationModal and the full page. Pending
// partner-requested slots sit at the top with Accept/Decline (the request
// endpoint is another branch's contract — specs/partner-crm.md §6 — this
// just calls it), then upcoming/past meetings with debrief + outcome.

import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import type { ApplicationDetail } from "../../lib/partner-application-detail";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

const OUTCOME_LABELS: Record<string, string> = {
  Advance: "Advance",
  Hold: "Hold",
  Reject: "Reject",
  MoreInfoNeeded: "Need more info",
};

function formatAt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { dateStyle: "medium" })} · ${d.toLocaleTimeString("en-US", { timeStyle: "short" })}`;
}

export function MeetingsTab({
  applicationId,
  meetings,
  meetingRequests,
  canEdit,
  limit,
  viewAllHref,
  onScheduleMeeting,
  onChanged,
}: {
  applicationId: string;
  meetings: ApplicationDetail["meetings"];
  meetingRequests: ApplicationDetail["meetingRequests"];
  canEdit: boolean;
  limit?: number;
  viewAllHref?: string;
  onScheduleMeeting?: () => void;
  onChanged: () => void;
}) {
  const pending = meetingRequests.filter((r) => r.status === "Pending");
  const shownMeetings = limit ? meetings.slice(0, limit) : meetings;
  const truncated = limit !== undefined && meetings.length > limit;

  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pending requests
          </h3>
          {pending.map((r) => (
            <PendingRequestRow key={r.id} request={r} canEdit={canEdit} onChanged={onChanged} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Meetings
          </h3>
          {canEdit && onScheduleMeeting && (
            <button type="button" onClick={onScheduleMeeting} className="text-xs font-medium text-accent-coral hover:underline">
              Schedule meeting
            </button>
          )}
        </div>

        {shownMeetings.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No meetings logged yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {shownMeetings.map((m) => (
              <MeetingRow key={m.id} meeting={m} canEdit={canEdit} applicationId={applicationId} onChanged={onChanged} />
            ))}
          </div>
        )}

        {truncated && viewAllHref && (
          <Link to={viewAllHref} className="self-start text-xs font-medium text-accent-coral hover:underline">
            View all {meetings.length} meetings →
          </Link>
        )}
      </section>
    </div>
  );
}

function PendingRequestRow({
  request,
  canEdit,
  onChanged,
}: {
  request: ApplicationDetail["meetingRequests"][number];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(action: "accept" | "decline") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/partner-meeting-requests/${request.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't respond to that request.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-2.5 text-sm">
      <div className="min-w-0">
        <p className="text-foreground">
          {formatAt(request.startTime)} · {request.durationMinutes} min
        </p>
        {request.note && <p className="text-xs text-muted-foreground">“{request.note}”</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-2">
          <Button variant="primary" size="xs" onClick={() => void respond("accept")} disabled={busy !== null}>
            {busy === "accept" ? "Accepting…" : "Accept"}
          </Button>
          <Button variant="secondary" size="xs" onClick={() => void respond("decline")} disabled={busy !== null}>
            {busy === "decline" ? "Declining…" : "Decline"}
          </Button>
        </div>
      )}
    </div>
  );
}

function MeetingRow({
  meeting,
  canEdit,
  applicationId,
  onChanged,
}: {
  meeting: ApplicationDetail["meetings"][number];
  canEdit: boolean;
  applicationId: string;
  onChanged: () => void;
}) {
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [debrief, setDebrief] = useState(meeting.debrief ?? "");
  const [outcome, setOutcome] = useState(meeting.outcome ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveDebrief() {
    setSaving(true);
    setError(null);
    const res = await postPartnerApplicationIntent(applicationId, "meeting-debrief", {
      meetingId: meeting.id,
      debrief: debrief.trim() || null,
      outcome: outcome || null,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't save the debrief.");
      return;
    }
    setDebriefOpen(false);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-1.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{formatAt(meeting.scheduledAt)}</p>
          {meeting.scheduledMeeting?.meetingUrl && (
            <a
              href={meeting.scheduledMeeting.meetingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-accent-coral hover:underline"
            >
              Join <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
          {meeting.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{meeting.notes}</p>}
          {meeting.debrief && <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{meeting.debrief}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meeting.outcome && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {OUTCOME_LABELS[meeting.outcome] ?? meeting.outcome}
            </span>
          )}
          {canEdit && (
            <button type="button" onClick={() => setDebriefOpen((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
              {debriefOpen ? "Close" : "Debrief"}
            </button>
          )}
        </div>
      </div>

      {debriefOpen && (
        <div className="mt-1 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
          <textarea
            value={debrief}
            onChange={(e) => setDebrief(e.target.value)}
            rows={3}
            placeholder="What happened? Key takeaways…"
            className="resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
          <Select
            value={outcome}
            onChange={setOutcome}
            ariaLabel="Meeting outcome"
            options={[
              { value: "", label: "No outcome set" },
              { value: "Advance", label: "Advance" },
              { value: "Hold", label: "Hold" },
              { value: "Reject", label: "Reject" },
              { value: "MoreInfoNeeded", label: "Need more info" },
            ]}
            buttonClassName="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => void saveDebrief()} disabled={saving}>
              {saving ? "Saving…" : "Save debrief"}
            </Button>
            <button type="button" onClick={() => setDebriefOpen(false)} className="text-xs text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
