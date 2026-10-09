import { useEffect, useState } from "react";
import { Link } from "react-router";
import { MoreHorizontal, Radio as RadioIcon } from "lucide-react";
import { Menu } from "~/components/ui/floating";
import { isRecordPromptWindow } from "./meeting-recorder/record-prompt-window";

const dismissKey = (meetingId: string, occurrenceStart: string) =>
  `dali:record-prompt-not-now:${meetingId}:${occurrenceStart}`;

/**
 * "This meeting is starting. Record it?" — shown above a meeting note or on
 * the meeting page while the occurrence is live (5 minutes before start
 * until end). All the gating (window math, the per-occurrence "Not now"
 * dismissal, and the props the caller's loader already resolved) lives here
 * so documents.$pageId.tsx and calendar.meeting.$id.tsx don't duplicate it.
 */
export function RecordPromptBanner({
  meetingId,
  occurrenceStart,
  windowEndIso,
  canEdit,
  recordingEnabled,
  recordPromptEnabled,
  hasActiveRecording,
  canDontSuggest,
  recordHref,
  onRecord,
  onDontSuggest,
}: {
  meetingId: string;
  /** ISO timestamp — the occurrence's original start (the window opens 5
   *  minutes before this). */
  occurrenceStart: string;
  /** ISO timestamp — when the window closes (start + durationMinutes). */
  windowEndIso: string;
  canEdit: boolean;
  recordingEnabled: boolean;
  recordPromptEnabled: boolean;
  hasActiveRecording: boolean;
  /** Organizer or Core — shows the overflow's "Don't suggest" item. */
  canDontSuggest: boolean;
  /** Link target when Record navigates elsewhere (calendar page → the note). */
  recordHref?: string;
  /** Called instead of navigating when Record opens a sheet in place (the note page). */
  onRecord?: () => void;
  onDontSuggest?: () => void;
}) {
  const [dismissed, setDismissed] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(dismissKey(meetingId, occurrenceStart)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [meetingId, occurrenceStart]);

  useEffect(() => {
    const start = new Date(occurrenceStart).getTime();
    const end = new Date(windowEndIso).getTime();
    const check = () => setLive(isRecordPromptWindow(Date.now(), start, end));
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [occurrenceStart, windowEndIso]);

  if (!live || !canEdit || !recordingEnabled || !recordPromptEnabled || hasActiveRecording || dismissed) return null;

  function notNow() {
    try {
      window.localStorage.setItem(dismissKey(meetingId, occurrenceStart), "1");
    } catch {
      // Storage unavailable — the banner just reappears next visit.
    }
    setDismissed(true);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-os-card border border-os-accent/30 bg-os-accent/10 px-4 py-2.5">
      <p className="flex items-center gap-2 text-sm text-foreground">
        <RadioIcon className="h-4 w-4 shrink-0 text-os-accent" aria-hidden />
        This meeting is starting. Record it?
      </p>
      <div className="flex items-center gap-1.5">
        {recordHref ? (
          <Link to={recordHref} className="os-btn-primary text-sm">
            Record
          </Link>
        ) : (
          <button type="button" onClick={onRecord} className="os-btn-primary text-sm">
            Record
          </button>
        )}
        <button
          type="button"
          onClick={notNow}
          className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-os-container"
        >
          Not now
        </button>
        {canDontSuggest && (
          <Menu
            align="right"
            ariaLabel="More options"
            trigger={
              <button
                type="button"
                aria-label="More options"
                className="rounded-full p-1.5 text-muted-foreground hover:bg-os-container"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            <Menu.Item onSelect={() => onDontSuggest?.()}>Don't suggest recording this meeting</Menu.Item>
          </Menu>
        )}
      </div>
    </div>
  );
}
