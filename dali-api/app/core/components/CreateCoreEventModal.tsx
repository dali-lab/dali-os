import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { CalendarDays, Clock, UsersRound, X } from "lucide-react";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";
import { Toggle } from "~/components/ui/Toggle";
import { DateField } from "~/components/ui/DateField";
import { Select } from "~/components/ui/floating";
import { modalCardClass } from "~/components/os-chrome";
import {
  NO_REPEAT,
  RepeatField,
  repeatSpecToRRule,
  type RepeatSpec,
} from "~/calendar/components/RepeatField";
import {
  useMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
  MeetingNoteFields,
} from "~/calendar/components/MeetingNoteFields";
import { durationMinutesBetween, toDatetimeLocal } from "~/calendar/lib/event-block";

// Create straight onto the Core calendar.
//
// The Events page's create modal schedules anything for anyone, and reaching
// the Core calendar from there means remembering to tick "Core meeting". This
// one only ever produces Core entries: isCoreMeeting is fixed on, and the only
// guest list on offer is the Core group — so what it makes lands on the Core
// hub and nowhere else.
//
// "Meeting or event" is the guest list, same rule as the Events modal: with the
// Core group invited it's a meeting (real Google invites to members' DALI
// Gmail, via the organizer's linked account); with nobody invited it's an event
// that just sits on the Core calendar.

export type CoreCalendarLink = {
  id: string;
  externalEmail: string;
  displayName: string | null;
};

export function CreateCoreEventModal({
  coreGroupId,
  calendarLinks,
  initialDateLocal,
  onClose,
}: {
  /** null until the Core system group is seeded — invites are unavailable then. */
  coreGroupId: string | null;
  calendarLinks: CoreCalendarLink[];
  /** "YYYY-MM-DDTHH:mm" seed for the start field (the day the grid is on). */
  initialDateLocal: string;
  onClose: () => void;
}) {
  const revalidator = useRevalidator();
  const [title, setTitle] = useState("");
  const [startLocal, setStartLocal] = useState(initialDateLocal);
  const [endLocal, setEndLocal] = useState(() => {
    if (!initialDateLocal) return "";
    const d = new Date(initialDateLocal);
    if (isNaN(d.getTime())) return "";
    d.setMinutes(d.getMinutes() + 60);
    return toDatetimeLocal(d);
  });
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  const [inviteCore, setInviteCore] = useState(!!coreGroupId);
  const [organizerCalendarLinkId, setOrganizerCalendarLinkId] = useState(
    calendarLinks[0]?.id ?? "",
  );
  const note = useMeetingNote();
  const [status, setStatus] = useState<
    null | { ok: true; count: number; notePageId: string | null } | { ok: false; error: string }
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const duration = durationMinutesBetween(startLocal, endLocal);
  const startEndValid =
    !startLocal || !endLocal || new Date(endLocal).getTime() > new Date(startLocal).getTime();
  const canSubmit =
    title.trim().length > 0 &&
    duration > 0 &&
    startEndValid &&
    meetingNoteValid(note.state) &&
    !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        durationMinutes: duration,
        // The whole point of this surface: everything it creates is Core's.
        isCoreMeeting: true,
      };
      const rrule = repeatSpecToRRule(repeat, startLocal);
      if (rrule) payload.recurrenceRule = rrule;
      const start = new Date(startLocal);
      if (!isNaN(start.getTime())) payload.startTime = start.toISOString();
      if (organizerCalendarLinkId) payload.organizerCalendarLinkId = organizerCalendarLinkId;
      Object.assign(payload, meetingNotePayload(note.state));
      if (inviteCore && coreGroupId) {
        payload.scopeType = "Group";
        payload.groupId = coreGroupId;
      } else {
        payload.scopeType = "None";
      }

      const res = await fetch("/api/scheduled-meetings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus({ ok: false, error: json.error ?? "Couldn't create this" });
        return;
      }
      setStatus({
        ok: true,
        count: json.notifiedCount ?? 0,
        notePageId: json.notePageId ?? null,
      });
      // The Core hub's grid reads the meeting rows, so a revalidate is what puts
      // the new block on screen before the modal closes.
      revalidator.revalidate();
      setTimeout(onClose, 1200);
    } catch (err) {
      setStatus({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "w-full px-3.5 py-2.5 text-sm border border-border rounded-[10px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40";
  const labelClass =
    "block text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] mb-2";

  const overlayRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create a Core meeting or event"
    >
      <div className={cn(modalCardClass("max-w-lg"), "w-full")}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-heading text-base font-semibold text-foreground">
            New on the Core calendar
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="os-form flex flex-col gap-4 px-5 py-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a title"
            required
            aria-label="Title"
            className="w-full border-0 border-b border-border bg-transparent px-0 pb-2 text-xl font-medium text-foreground placeholder:text-muted-foreground/70 focus:border-os-accent focus:outline-none focus:ring-0"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Starts
                </span>
              </label>
              <DateField
                mode="datetime-local"
                value={startLocal}
                onChange={(next) => {
                  setStartLocal(next);
                  if (
                    next &&
                    (!endLocal || new Date(endLocal).getTime() <= new Date(next).getTime())
                  ) {
                    const d = new Date(next);
                    d.setMinutes(d.getMinutes() + (duration > 0 ? duration : 60));
                    setEndLocal(toDatetimeLocal(d));
                  }
                }}
                className="w-full"
                ariaLabel="Starts"
              />
            </div>
            <div>
              <label className={labelClass}>Ends</label>
              <DateField
                mode="datetime-local"
                value={endLocal}
                min={startLocal || undefined}
                onChange={setEndLocal}
                className="w-full"
                ariaLabel="Ends"
              />
              {!startEndValid && <p className="mt-1 text-xs text-red-600">End must be after start.</p>}
            </div>
          </div>

          <RepeatField
            value={repeat}
            onChange={setRepeat}
            anchorLocal={startLocal}
            labelClassName={labelClass}
            fieldClassName={fieldClass}
          />

          {/* Guests: the Core group or nobody — this surface has no other list. */}
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <Checkbox
              checked={inviteCore}
              disabled={!coreGroupId}
              onChange={(e) => setInviteCore(e.target.checked)}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <UsersRound className="h-3.5 w-3.5" /> Invite Core
                </span>
              }
              description={
                coreGroupId
                  ? "Sends a calendar invite to every Core member's DALI account. Leave it off for something that only belongs on the calendar."
                  : "The Core group isn't set up yet, so invites aren't available."
              }
            />
          </div>

          {inviteCore && (
            <div>
              <label className={labelClass}>Send invite from</label>
              {calendarLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No Google account linked. Link one in My Availability to send calendar invites —
                  members are still notified in DALI.
                </p>
              ) : (
                <Select
                  value={organizerCalendarLinkId}
                  onChange={setOrganizerCalendarLinkId}
                  options={[
                    { value: "", label: "No invite (in-app notification only)" },
                    ...calendarLinks.map((l) => ({
                      value: l.id,
                      label: l.displayName
                        ? `${l.displayName} — ${l.externalEmail}`
                        : l.externalEmail,
                    })),
                  ]}
                  buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
                />
              )}
            </div>
          )}

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <Toggle
              checked={note.state.enabled}
              onChange={(e) => note.setEnabled(e.target.checked)}
              label="Create meeting notes"
              description="Starts a shared notes doc, linked from the block on this calendar."
            />
            {note.state.enabled && (
              <div className="mt-3 pt-1">
                <MeetingNoteFields
                  note={note}
                  fieldClass={fieldClass}
                  labelClass={labelClass}
                  // Everything this modal makes is Core's, so the note is too.
                  core
                />
              </div>
            )}
          </div>

          {status?.ok === true && (
            <p className="text-sm text-green-700">
              Added to the Core calendar
              {status.count > 0
                ? `. Notified ${status.count} Core member${status.count === 1 ? "" : "s"}.`
                : "."}
              {status.notePageId && (
                <>
                  {" "}
                  <a href={`/documents/${status.notePageId}`} className="font-medium underline">
                    View meeting note
                  </a>
                </>
              )}
            </p>
          )}
          {status?.ok === false && <p className="text-sm text-red-600">{status.error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-os-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-os-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CalendarDays className="h-4 w-4" />
              {submitting ? "Creating…" : "Add to Core calendar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
