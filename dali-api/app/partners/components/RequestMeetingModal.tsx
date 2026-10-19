import { useState } from "react";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { Select } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { ScheduleWeekGrid } from "~/calendar/components/scheduling";
import { weekWindow } from "~/calendar/lib/view-window";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";

const DURATION_OPTIONS = [
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "60 minutes" },
];

// The portal's "Request a meeting" modal — the real scheduler grid, scoped
// server-side to an application's interview panel or a project's team
// (specs/partner-crm.md §6). The partner never sees per-member calendars:
// ScheduleWeekGrid renders its aggregate-only view here (no userIds, an
// availabilityBody carrying the scope instead).
export function RequestMeetingModal({
  scope,
  onClose,
  onSent,
}: {
  scope: { applicationId: string } | { projectId: string };
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [durationMinutes, setDurationMinutes] = useState<"30" | "45" | "60">("30");
  const [note, setNote] = useState("");
  const [selectedStartLocal, setSelectedStartLocal] = useState<string | undefined>();
  const [selectedEndLocal, setSelectedEndLocal] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [weekStartIso, setWeekStartIso] = useState(() => weekWindow(timezone).start.toISOString());
  const weekEndIso = new Date(new Date(weekStartIso).getTime() + 7 * 86_400_000).toISOString();
  const shiftWeek = (weeks: number) => {
    const ymd = getZonedYMD(new Date(weekStartIso), timezone);
    setWeekStartIso(zonedDayStartUtc(ymd.year, ymd.month, ymd.day + weeks * 7, timezone).toISOString());
  };
  const goToThisWeek = () => setWeekStartIso(weekWindow(timezone).start.toISOString());

  const canSubmit = !!selectedStartLocal && !submitting;

  async function submit() {
    if (!selectedStartLocal) return;
    const start = new Date(selectedStartLocal);
    if (isNaN(start.getTime())) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/partner/meeting-requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...scope,
          startTime: start.toISOString(),
          durationMinutes: Number(durationMinutes),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to send the request");
        return;
      }
      toast.success("Request sent. We will confirm by email.");
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="request-meeting-title"
      containerClassName={modalCardClass("max-w-3xl")}
    >
      <ModalHeader
        titleId="request-meeting-title"
        title="Request a meeting"
        subtitle="Pick a time that works for you. The team confirms by email."
        onClose={onClose}
      />

      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm text-foreground">
          Length
          <Select
            value={durationMinutes}
            onChange={(v) => setDurationMinutes(v as "30" | "45" | "60")}
            options={DURATION_OPTIONS}
            buttonClassName="rounded-full border border-border px-3 py-1.5 text-sm"
          />
        </label>

        <ScheduleWeekGrid
          participantIds={[]}
          users={[]}
          workingHours={[]}
          workingHoursEnabled={false}
          durationMinutes={Number(durationMinutes)}
          timezone={timezone}
          weekStartIso={weekStartIso}
          weekEndIso={weekEndIso}
          onSelectRange={(s, e) => {
            setSelectedStartLocal(s);
            setSelectedEndLocal(e);
          }}
          selectedStartLocal={selectedStartLocal}
          selectedEndLocal={selectedEndLocal}
          compact
          weekNav={{ onShift: shiftWeek, onToday: goToThisWeek }}
          availabilityUrl="/api/partner/availability"
          availabilityBody={scope}
        />

        <div>
          <label htmlFor="request-meeting-note" className="mb-1 block text-xs font-medium text-muted-foreground">
            Anything the team should know? (optional)
          </label>
          <textarea
            id="request-meeting-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <ModalFooter onCancel={onClose}>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-xl bg-dark-blue text-white text-sm font-heading font-semibold px-5 py-2.5 hover:opacity-90 transition disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send request"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
