import { useEffect, useState } from "react";
import { Modal } from "~/components/Modal";
import { CreateEventModal } from "~/calendar/components/CreateEventModal";
import type { SchedulingData } from "~/calendar/lib/types";

// Opens the real calendar scheduler, scoped to one partner interview: Core
// picks a time on the shared availability grid, the meeting is created as a
// real ScheduledMeeting (Google invite + Meet link for the partner), and it's
// linked back to the application (specs/partner-crm.md §6).
export function ScheduleInterviewModal({
  applicationId,
  partnerName,
  partnerEmail,
  onClose,
  onScheduled,
}: {
  applicationId: string;
  partnerName: string;
  partnerEmail: string;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [data, setData] = useState<SchedulingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scheduling-data", { credentials: "include" })
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError((json as { error?: string }).error ?? "Failed to load your calendar");
        } else {
          setData(json as SchedulingData);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Network error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Links the just-created ScheduledMeeting back to the application, then
  // hands control back to the caller — same order CreateEventModal calls it
  // in (onCreated before its own onClose).
  async function link(scheduledMeetingId: string) {
    try {
      await fetch(`/api/partner-applications/${applicationId}/meetings/link`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledMeetingId }),
      });
    } finally {
      onScheduled();
      onClose();
    }
  }

  if (!data) {
    return (
      <Modal open onClose={onClose} labelledBy="schedule-interview-title">
        <h2 id="schedule-interview-title" className="text-lg font-semibold text-foreground mb-2">
          Schedule interview
        </h2>
        <p className="text-sm text-muted-foreground">{error ?? "Loading your calendar…"}</p>
        {error && (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        )}
      </Modal>
    );
  }

  return (
    <CreateEventModal
      data={data}
      mode="meeting-only"
      fixedGuestEmails={[partnerEmail]}
      defaultTitle={`DALI x ${partnerName}`}
      initialUserIds={[data.currentUserId]}
      onCreated={link}
      onClose={onClose}
    />
  );
}
