import { useState } from "react";

// Rendered above AttendanceChecklist on a meeting-note page whose
// ScheduledMeeting.attendanceMode is "SelfCheckIn" — an alternative to
// checking a big roster off by hand. Two independent pieces, each gated by
// who's viewing:
//   - The check-in button: shown to any invited viewer (they got here either
//     by scanning the QR/link below, or just by opening the note directly).
//     POSTs to the check-in route, which resolves the userId from their own
//     session — never from anything in this component's props.
//   - The QR/link card: shown only to the organizer/Core (canMark upstream),
//     for them to display or share so attendees can scan it at the event.
export function CheckInPanel({
  meetingId,
  meetingLabel,
  viewerInvited,
  initialPresent,
  checkInUrl,
  checkInQrSvg,
}: {
  meetingId: string;
  meetingLabel: string;
  viewerInvited: boolean;
  initialPresent: boolean;
  checkInUrl: string | null;
  checkInQrSvg: string | null;
}) {
  const [present, setPresent] = useState(initialPresent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/scheduled-meetings/${meetingId}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Check-in failed");
        return;
      }
      setPresent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {viewerInvited && (
        <section className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading font-semibold text-foreground">{meetingLabel}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {present ? "You're checked in." : "Check in to mark yourself present."}
            </p>
            {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
          </div>
          <button
            type="button"
            onClick={checkIn}
            disabled={present || submitting}
            className="px-4 py-2 rounded-md bg-accent-coral text-white text-sm font-medium hover:bg-accent-coral/90 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {present ? "Checked in" : submitting ? "Checking in…" : "Check in"}
          </button>
        </section>
      )}
      {checkInUrl && checkInQrSvg && (
        <section className="bg-card border border-border rounded-lg p-4 flex items-center gap-4">
          <div
            className="w-24 h-24 flex-shrink-0 [&_svg]:w-full [&_svg]:h-full"
            dangerouslySetInnerHTML={{ __html: checkInQrSvg }}
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Self check-in</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Display this QR code at the event, or share the link — attendees who scan/open it
              (while signed in) mark themselves present within the check-in window.
            </p>
            <a
              href={checkInUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent-teal hover:underline break-all"
            >
              {checkInUrl}
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
