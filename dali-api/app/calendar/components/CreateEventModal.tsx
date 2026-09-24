import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { AlignLeft, CalendarDays, Clock, DoorOpen, MapPin, Repeat, UsersRound, Video, X } from "lucide-react";
import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { TimeField as TimeComboField } from "~/components/ui/TimeField";
import { Select } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { RoomPicker } from "~/rooms/components/RoomPicker";
import {
  ScheduleWeekGrid,
  ParticipantPicker,
  OptimalTimePills,
  type SlotSuggestions,
} from "~/calendar/components/scheduling";
import {
  NO_REPEAT,
  RepeatField,
  repeatSpecToRRule,
  type RepeatSpec,
} from "~/calendar/components/RepeatField";
import {
  eventDestinations,
  inviteDestinations,
  inviteOrganizerFields,
  addDaysToDate,
} from "~/calendar/components/composer";
import { durationMinutesBetween } from "~/calendar/lib/event-block";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import { weekStartIsoForDay, weekWindow } from "~/calendar/lib/view-window";
import {
  useMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
  MeetingNoteFields,
} from "~/calendar/components/MeetingNoteFields";
import { TimesheetFields } from "~/calendar/components/TimesheetFields";
import type { LoaderData } from "~/calendar/lib/types";

// ── Props ──────────────────────────────────────────────────────────────────

export type CreateEventModalProps = {
  data: LoaderData;
  startLocal?: string;
  endLocal?: string;
  /** Guests to open with already invited — the "Meet with" flow passes one
   *  person so the availability grid is useful the moment the modal opens. */
  initialUserIds?: string[];
  /** Groups to open with already invited — a project's "Schedule meeting"
   *  deep link passes that project's group so the whole team is preselected. */
  initialGroupIds?: string[];
  onClose: () => void;
};

// ── Helpers ────────────────────────────────────────────────────────────────

// Compose "YYYY-MM-DDTHH:mm" from separate date + time strings.
function composeDateTimeLocal(date: string, time: string): string {
  if (!date || !time) return "";
  return `${date}T${time}`;
}

// Parse "HH:mm" time string; returns minutes since midnight.
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// Derive the end date — same as start unless end time < start time.
function endDate(startDate: string, startTime: string, endTime: string): string {
  if (!startDate) return startDate;
  if (startTime && endTime && timeToMinutes(endTime) < timeToMinutes(startTime)) {
    return addDaysToDate(startDate, 1);
  }
  return startDate;
}

// Convert "YYYY-MM-DDTHH:mm" to a real ISO instant via the browser local clock.
// For event-create we send the ISO directly (Google API), and the server uses it
// with the timeZone field to anchor the wall-clock time.
function localToIso(localStr: string): string {
  if (!localStr) return "";
  const d = new Date(localStr);
  if (isNaN(d.getTime())) return "";
  return d.toISOString();
}

// Extract "HH:mm" from "YYYY-MM-DDTHH:mm".
function extractTime(local: string): string {
  if (!local || !local.includes("T")) return "";
  return local.split("T")[1]?.slice(0, 5) ?? "";
}

// Extract "YYYY-MM-DD" from "YYYY-MM-DDTHH:mm".
function extractDate(local: string): string {
  if (!local || !local.includes("T")) return local ?? "";
  return local.split("T")[0] ?? "";
}

/** One line of the create form, Google-style: a leading glyph in the gutter and
 *  the control itself carrying its own meaning, instead of a shouted label
 *  stacked above every field. */
function FieldRow({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <Icon className="mt-2.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function CreateEventModal({
  data,
  startLocal: initStart,
  endLocal: initEnd,
  initialUserIds,
  initialGroupIds,
  onClose,
}: CreateEventModalProps) {
  // ── Destination (writable Google calendars) ──────────────────────────────
  const dests = eventDestinations(data);
  const defaultDest =
    data.defaultEventDest && dests.some((d) => d.value === data.defaultEventDest)
      ? data.defaultEventDest
      : dests[0]?.value ?? "";
  // Dev keeps the full form even with nothing linked, so the create UI is
  // workable against a local database that has no calendar links. Vite folds
  // this to `dests.length > 0` in a production build.
  const hasWritableDest = dests.length > 0 || import.meta.env.DEV;

  // ── Core form state ──────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string>(() => extractDate(initStart ?? ""));
  const [startTime, setStartTime] = useState<string>(() => extractTime(initStart ?? ""));
  const [endTime, setEndTime] = useState<string>(() => extractTime(initEnd ?? ""));
  const [location, setLocation] = useState("");
  const roomBooking = useFeatureFlag("room-booking");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [destination, setDestination] = useState(defaultDest);

  // ── All-day state ────────────────────────────────────────────────────────
  const [allDay, setAllDay] = useState(false);
  const [dStart, setDStart] = useState(() => extractDate(initStart ?? ""));
  const [dEnd, setDEnd] = useState(() => extractDate(initEnd ?? "") || extractDate(initStart ?? ""));

  // ── Repeat / recurrence ──────────────────────────────────────────────────
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);

  // ── Timesheet ────────────────────────────────────────────────────────────
  const [isWork, setIsWork] = useState(false);
  const [roleKey, setRoleKey] = useState("");
  const [workNote, setWorkNote] = useState("");

  // ── Participants / type detection ────────────────────────────────────────
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(initialUserIds ?? []);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(initialGroupIds ?? []);
  const [guestEmails, setGuestEmails] = useState<string[]>([]);

  const usersById = new Map(data.users.map((u) => [u.id, u]));
  const groupsById = new Map(data.groups.map((g) => [g.id, g]));

  const resolvedParticipantIds = (() => {
    const set = new Set<string>(selectedUserIds);
    for (const gid of selectedGroupIds) {
      const g = groupsById.get(gid);
      if (g) for (const uid of g.memberIds) set.add(uid);
    }
    return Array.from(set);
  })();

  const hasGuests = selectedUserIds.length > 0 || selectedGroupIds.length > 0 || guestEmails.length > 0;
  const type = hasGuests ? "Meeting" : "Event";

  // ── Core meeting ─────────────────────────────────────────────────────────
  // Core-only marker that lifts the meeting onto the Core hub calendar without
  // touching its guest list. Inviting the Core group implies it.
  const coreSelected = selectedGroupIds.some((gid) => groupsById.get(gid)?.systemKey === "core");
  const [coreMeeting, setCoreMeeting] = useState(false);
  useEffect(() => {
    if (coreSelected) setCoreMeeting(true);
  }, [coreSelected]);
  const isCoreMeeting = coreSelected || (data.canMarkCoreMeeting && coreMeeting);

  // ── Meeting note fields (only shown in Meeting mode) ─────────────────────
  // Derive-type-from-project model; see MeetingNoteFields.
  const note = useMeetingNote();

  // Prefill "About" when exactly one invited group is a project group — a default
  // the sender can still change; it never enables the note on its own. A Core
  // project meeting still prefills its project.
  useEffect(() => {
    if (selectedGroupIds.length !== 1) return;
    note.applyGroupPrefill(groupsById.get(selectedGroupIds[0]!)?.projectId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupIds]);

  // Send the invite from a specific calendar, not just an account — the same
  // sub-calendars the event destination offers. Starts on the event default
  // (last-used calendar) when it's in the list.
  const inviteDests = inviteDestinations(data.calendarLinks);
  const [inviteFrom, setInviteFrom] = useState<string>(() =>
    inviteDests.some((d) => d.value === defaultDest) ? defaultDest : inviteDests[0]?.value ?? "",
  );

  // ── Google Meet ──────────────────────────────────────────────────────────
  // The link is minted on the selected Google calendar, so the option only
  // makes sense with a Google destination and real guests.
  const optimalTimesEnabled = useFeatureFlag("optimal-times");
  // Ranked "best times" reported up by the availability grid; rendered as
  // clickable pills below it (see OptimalTimePills).
  const [optimalSuggestions, setOptimalSuggestions] = useState<SlotSuggestions | null>(null);
  const [addMeet, setAddMeet] = useState(false);
  const canAddMeet = !!inviteFrom && hasGuests;

  // ── Week navigation for the left panel ───────────────────────────────────
  const weekStartForDate = (day: string) => weekStartIsoForDay(data.timezone, day);
  // Opening on a dragged-out slot should show that slot's week, which isn't
  // necessarily the week the calendar behind the modal was on (a month-view
  // drag can land outside it).
  const [weekStartIso, setWeekStartIso] = useState(() => {
    const day = extractDate(initStart ?? "");
    return day ? weekStartForDate(day) : data.weekStartIso;
  });
  // Keep the week start on zoned midnight (like the loader's weekWindow) so the
  // availability fetch covers the whole local week. A bare YYYY-MM-DD from
  // shiftWeekParam parses as UTC midnight, which is hours off in US zones.
  const shiftWeek = (weeks: number) => {
    const ymd = getZonedYMD(new Date(weekStartIso), data.timezone);
    setWeekStartIso(
      zonedDayStartUtc(ymd.year, ymd.month, ymd.day + weeks * 7, data.timezone).toISOString(),
    );
  };
  const goToThisWeek = () => setWeekStartIso(weekWindow(data.timezone).start.toISOString());
  const weekEndIso = new Date(new Date(weekStartIso).getTime() + 7 * 86_400_000).toISOString();

  // Choosing the day to meet on is what moves the preview — otherwise picking a
  // date in another week leaves you reading this week's availability while the
  // meeting is somewhere else entirely. The pull is one-directional on purpose:
  // the week arrows browse freely without rewriting the date, and picking a slot
  // inside the week already on screen resolves to the same week, so neither can
  // fight the other.
  const pickDate = (day: string) => {
    setDate(day);
    if (day) setWeekStartIso(weekStartForDate(day));
  };
  const pickAllDayStart = (day: string) => {
    setDStart(day);
    if (day) setWeekStartIso(weekStartForDate(day));
  };

  // ── Slot selected from the availability grid ─────────────────────────────
  const handleSelectRange = (s: string, e: string) => {
    // s and e are "YYYY-MM-DDTHH:mm" local strings from the grid
    pickDate(extractDate(s));
    setStartTime(extractTime(s));
    setEndTime(extractTime(e));
  };

  // Compose the full local strings for the grid highlight
  const effEndDate = endDate(date, startTime, endTime);
  const selectedStartLocal = composeDateTimeLocal(date, startTime);
  const selectedEndLocal = composeDateTimeLocal(effEndDate, endTime);

  // Derive the ISO instants sent to the server.
  // All-day: start = YYYY-MM-DDT00:00:00.000Z; end = exclusive next day (Google convention).
  // Timed: convert via browser locale (same as the existing behavior).
  const startIso = allDay
    ? dStart ? `${dStart}T00:00:00.000Z` : ""
    : localToIso(selectedStartLocal);
  const endIso = allDay
    ? dEnd ? `${addDaysToDate(dEnd, 1)}T00:00:00.000Z` : ""
    : localToIso(selectedEndLocal);

  // The anchor for RepeatField (the series start in local wall-clock form).
  const repeatAnchorLocal = allDay ? dStart : selectedStartLocal;

  // ── Derived duration ─────────────────────────────────────────────────────
  const durationMinutes = allDay ? 0 : durationMinutesBetween(selectedStartLocal, selectedEndLocal);
  const startEndValid =
    allDay
      ? !dStart || !dEnd || dStart <= dEnd
      : !selectedStartLocal ||
        !selectedEndLocal ||
        new Date(selectedEndLocal).getTime() > new Date(selectedStartLocal).getTime();

  // ── Submission state ─────────────────────────────────────────────────────
  const eventFetcher = useFetcher<{ error?: string }>();
  const timeFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [meetingStatus, setMeetingStatus] = useState<
    | null
    | {
        ok: true;
        count: number;
        gcalError?: string | null;
        notePageId?: string | null;
        whiteboardPageId?: string | null;
      }
    | { ok: false; error: string }
  >(null);
  const [submitting, setSubmitting] = useState(false);

  // Close after a successful event-create (fetcher settles with no error data)
  const prevEventState = useRef(eventFetcher.state);
  useEffect(() => {
    if (prevEventState.current !== "idle" && eventFetcher.state === "idle") {
      if (!eventFetcher.data?.error) {
        onClose();
      }
    }
    prevEventState.current = eventFetcher.state;
  }, [eventFetcher.state, eventFetcher.data, onClose]);

  // An all-day event has no range for hours to measure, and the server rejects
  // it, so the Event form drops the toggle there. A repeating Google event is
  // rejected too: the create returns the series master, whose id matches none
  // of the occurrence ids the grid draws, so a log keyed on it would be
  // invisible.
  const eventCanLogWork = !allDay && repeatSpecToRRule(repeat, repeatAnchorLocal) === null;
  const eventLoggingWork = isWork && eventCanLogWork;
  // A meeting keeps the toggle when it repeats. The log links to the
  // ScheduledMeeting (one row per meeting per user) and is dated to the series
  // anchor — the first occurrence, the one time being scheduled here.
  const meetingRepeats = repeatSpecToRRule(repeat, selectedStartLocal) !== null;

  // ── canSubmit ────────────────────────────────────────────────────────────
  const canSubmitEvent =
    title.trim() !== "" &&
    destination !== "" &&
    startIso !== "" &&
    endIso !== "" &&
    startEndValid &&
    startIso < endIso &&
    (!eventLoggingWork || (roleKey !== "" && workNote.trim() !== ""));

  const canSubmitMeeting =
    title.trim() !== "" &&
    durationMinutes > 0 &&
    startEndValid &&
    meetingNoteValid(note.state) &&
    (!isWork || (roleKey !== "" && workNote.trim() !== "")) &&
    !submitting;

  // ── Meeting submit ───────────────────────────────────────────────────────
  async function submitMeeting(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMeetingStatus(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        durationMinutes,
      };
      if (location.trim()) payload.location = location.trim();
      if (roomBooking && roomIds.length) payload.roomIds = roomIds;
      if (description.trim()) payload.description = description.trim();
      if (selectedStartLocal) {
        const d = new Date(selectedStartLocal);
        if (!isNaN(d.getTime())) payload.startTime = d.toISOString();
      }
      Object.assign(payload, inviteOrganizerFields(inviteFrom));
      const rrule = repeatSpecToRRule(repeat, selectedStartLocal);
      if (rrule) payload.recurrenceRule = rrule;
      if (canAddMeet && addMeet) payload.addMeet = true;
      Object.assign(payload, meetingNotePayload(note.state));
      if (isCoreMeeting) {
        payload.isCoreMeeting = true;
      }
      if (guestEmails.length > 0) payload.guestEmails = guestEmails;
      if (selectedGroupIds.length === 1 && selectedUserIds.length === 0) {
        payload.scopeType = "Group";
        payload.groupId = selectedGroupIds[0];
      } else if (resolvedParticipantIds.length > 0) {
        payload.scopeType = "UserList";
        payload.participantUserIds = resolvedParticipantIds;
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
        setMeetingStatus({ ok: false, error: json.error ?? "Failed to create meeting" });
      } else {
        setMeetingStatus({
          ok: true,
          count: json.notifiedCount ?? 0,
          gcalError: json.gcalError ?? null,
          notePageId: json.notePageId ?? null,
          whiteboardPageId: json.whiteboardPageId ?? null,
        });
        // If isWork, log the organizer's time against the meeting we just
        // created — linked by its id so it shows as an accent on the meeting
        // block (not a duplicate) and isn't mirrored to the Timesheet calendar.
        if (isWork && roleKey && startIso && endIso) {
          const [assignmentType, roleRefId] = roleKey.split("::");
          const meetingId = json.meeting?.id as string | undefined;
          if (assignmentType && roleRefId) {
            timeFetcher.submit(
              {
                intent: "add-time-entry",
                date: startIso.slice(0, 10),
                hours: String(durationMinutes / 60),
                assignmentType,
                roleRefId,
                note: workNote.trim(),
                startTime: startIso,
                endTime: endIso,
                ...(meetingId ? { scheduledMeetingId: meetingId } : {}),
              },
              { method: "post" },
            );
          }
        }
        // The meeting POST goes out through plain fetch(), which the router
        // knows nothing about — so nothing revalidates and the grid keeps
        // painting the pre-create window until the next navigation or window
        // focus. Ask for it by hand, the way CreateCoreEventModal does, and the
        // new block is already on screen behind the success message by the time
        // the modal closes. (calendar.tsx's shouldRevalidate deliberately lets a
        // same-URL revalidate through for exactly this case.)
        revalidator.revalidate();
        setTimeout(() => onClose(), 1200);
      }
    } catch (err) {
      setMeetingStatus({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "w-full px-3.5 py-2.5 text-sm border border-border rounded-[10px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40";
  const labelClass = "block text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] mb-2";
  // The minimal dress: the title carries the modal's heading weight on a bare
  // underline, and the icon rows use borderless controls that only show their
  // frame on hover/focus — so the form reads as a list of lines, not a stack
  // of boxes.
  const titleClass =
    "w-full border-0 border-b border-border bg-transparent px-0 pb-2 text-2xl font-medium text-foreground placeholder:text-muted-foreground/70 focus:border-os-accent focus:outline-none focus:ring-0";
  const quietFieldClass =
    "w-full rounded-[10px] border border-transparent bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground hover:border-border focus:border-os-accent focus:bg-background focus:outline-none";

  // ── Availability caption ─────────────────────────────────────────────────
  // Show the caption when there are no guests (grid has no availability to show)
  // or when a time hasn't been picked yet.
  const availCaption = !hasGuests
    ? "Add guests to see their availability"
    : !selectedStartLocal
      ? "Pick a time to see who's available"
      : null;

  // ── Backdrop click handler ────────────────────────────────────────────────
  const overlayRef = useRef<HTMLDivElement>(null);
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  // ── Shared timesheet section ──────────────────────────────────────────────
  // The same TimesheetFields block in both Event and Meeting modes; the helper
  // line adapts to whether a repeating meeting is being scheduled. Hidden only
  // when the viewer has no roles to log against (the toggle would dead-end).
  const timesheetSection =
    data.myRoles.length > 0 ? (
      <TimesheetFields
        isWork={isWork}
        onIsWorkChange={(next) => {
          setIsWork(next);
          if (!next) {
            setRoleKey("");
            setWorkNote("");
          }
        }}
        roleKey={roleKey}
        onRoleKeyChange={setRoleKey}
        roleOptions={data.myRoles.map((r) => ({
          value: `${r.assignmentType}::${r.roleRefId}`,
          label: r.label,
        }))}
        workNote={workNote}
        onWorkNoteChange={setWorkNote}
        description={
          type === "Meeting" && meetingRepeats
            ? "Logs the first occurrence to your timesheet once the meeting is created."
            : "Automatically logs this event to your timesheet once it's created."
        }
        fieldClass={fieldClass}
      />
    ) : null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={handleOverlayClick}
    >
      <div
        className={cn(
          "relative z-10 flex w-full flex-col sm:flex-row overflow-hidden rounded-xl cal-surface max-h-[90vh]",
          hasGuests ? "max-w-[88rem]" : "max-w-lg",
        )}
      >
        {/* ── Left panel: availability grid — only shown once there are guests
            (a solo event has no availability worth previewing). ───────────── */}
        {hasGuests && (
        <div className="flex min-h-0 w-full sm:w-[58%] shrink-0 flex-col gap-3 overflow-y-auto border-b sm:border-b-0 sm:border-r border-border bg-muted/20 p-5">
          {/* Availability grid — compact + no self-only tint when no guests */}
          <div className="shrink-0">
            <ScheduleWeekGrid
              participantIds={
                hasGuests
                  ? Array.from(new Set([...resolvedParticipantIds, data.currentUserId]))
                  : [data.currentUserId]
              }
              showingSelfOnly={!hasGuests}
              users={data.users}
              workingHours={data.workingHours}
              workingHoursEnabled={data.hasPersistedWorkingHours}
              durationMinutes={durationMinutes}
              timezone={data.timezone}
              weekStartIso={weekStartIso}
              weekEndIso={weekEndIso}
              onSelectRange={handleSelectRange}
              selectedStartLocal={selectedStartLocal || undefined}
              selectedEndLocal={selectedEndLocal || undefined}
              compact
              hideAvailability={!hasGuests}
              enableOptimalTimes={optimalTimesEnabled}
              onSuggestionsChange={setOptimalSuggestions}
              weekNav={{ onShift: shiftWeek, onToday: goToThisWeek }}
            />
          </div>

          <OptimalTimePills
            suggestions={optimalSuggestions}
            selectedStartLocal={selectedStartLocal || undefined}
            onPick={handleSelectRange}
          />

          {availCaption && (
            <p className="text-center text-xs text-muted-foreground">{availCaption}</p>
          )}
        </div>
        )}

        {/* ── Right panel: form ──────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
          {/* Header */}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* No writable dest: show empty state */}
          {!hasWritableDest ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Connect a Google Calendar you can write to first (Settings → Calendar).
              </p>
            </div>
          ) : type === "Event" ? (
            /* ── Event form ──────────────────────────────────────────────── */
            <eventFetcher.Form method="post" className="flex flex-col gap-5">
              <input type="hidden" name="intent" value="event-create" />
              <input type="hidden" name="destination" value={destination} />
              <input type="hidden" name="startIso" value={startIso} />
              <input type="hidden" name="endIso" value={endIso} />
              <input type="hidden" name="allDay" value={allDay ? "1" : ""} />
              <input type="hidden" name="timeZone" value={data.timezone} />
              <input type="hidden" name="recurrenceRule" value={repeatSpecToRRule(repeat, repeatAnchorLocal) ?? ""} />
              <input type="hidden" name="description" value={description} />
              {eventLoggingWork && roleKey && (
                <>
                  <input type="hidden" name="isWork" value="1" />
                  <input type="hidden" name="assignmentType" value={roleKey.split("::")[0] ?? ""} />
                  <input type="hidden" name="roleRefId" value={roleKey.split("::")[1] ?? ""} />
                  <input type="hidden" name="workNote" value={workNote.trim()} />
                </>
              )}

              {/* Title — the one field that carries the modal's heading weight */}
              <input
                id="cem-title"
                name="title"
                type="text"
                required
                placeholder="Add title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={titleClass}
              />

              {/* Guests */}
              <FieldRow icon={UsersRound}>
                <ParticipantPicker
                  users={data.users}
                  groups={data.groups}
                  selectedUserIds={selectedUserIds}
                  selectedGroupIds={selectedGroupIds}
                  onChangeUsers={setSelectedUserIds}
                  onChangeGroups={setSelectedGroupIds}
                  usersById={usersById}
                  groupsById={groupsById}
                  resolvedCount={resolvedParticipantIds.length}
                  guestEmails={guestEmails}
                  onChangeGuestEmails={inviteDests.length > 0 ? setGuestEmails : undefined}
                />
              </FieldRow>

              {/* Date & Time — all-day toggle + date/time inputs */}
              <FieldRow icon={Clock}>
                {/* All-day toggle */}
                <label className="mb-3 flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={allDay} onChange={() => setAllDay((v) => !v)} /> All day
                </label>
                {allDay ? (
                  /* All-day: start date → end date */
                  <div className="flex items-center gap-2 text-sm">
                    <DateField
                      mode="date"
                      value={dStart}
                      onChange={pickAllDayStart}
                      ariaLabel="Start date"
                      className="min-w-0 flex-1"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <DateField
                      mode="date"
                      value={dEnd}
                      onChange={setDEnd}
                      ariaLabel="End date"
                      className="min-w-0 flex-1"
                    />
                  </div>
                ) : (
                  /* Timed: single date + start/end times */
                  <div className="flex flex-wrap items-center gap-2.5">
                    <DateField
                      mode="date"
                      value={date}
                      onChange={pickDate}
                      ariaLabel="Date"
                      className="min-w-[150px]"
                    />
                    <TimeComboField
                      value={startTime}
                      onChange={(v) => setStartTime(v)}
                      aria-label="Start time"
                      className="w-[120px]"
                    />
                    <span className="text-xs text-muted-foreground">–</span>
                    <TimeComboField
                      value={endTime}
                      onChange={(v) => setEndTime(v)}
                      aria-label="End time"
                      className="w-[120px]"
                    />
                  </div>
                )}
                {!startEndValid && (
                  <p className="mt-1 text-xs text-red-600">
                    {allDay ? "End date must not be before start date." : "End must be after start."}
                  </p>
                )}
              </FieldRow>

              {/* Destination calendar — always shown (single-dest falls through as hidden) */}
              <FieldRow icon={CalendarDays}>
                {dests.length > 1 ? (
                  <Select
                    value={destination}
                    onChange={(v) => setDestination(v)}
                    options={dests}
                    buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1`}
                  />
                ) : dests.length === 1 ? (
                  <p className="text-sm text-muted-foreground">{dests[0]!.label}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Connect a Google Calendar… (Settings → Calendar)
                  </p>
                )}
              </FieldRow>

              <FieldRow icon={MapPin}>
                <input
                  id="cem-location"
                  name="location"
                  type="text"
                  placeholder="Add location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={quietFieldClass}
                />
              </FieldRow>

              <FieldRow icon={AlignLeft}>
                <textarea
                  id="cem-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add description"
                  rows={2}
                  className={cn(quietFieldClass, "resize-y")}
                />
              </FieldRow>

              {/* Repeat / recurrence — hidden for all-day (Google doesn't support RRULE on all-day events via this flow) */}
              {!allDay && (
                <FieldRow icon={Repeat}>
                  <RepeatField
                    value={repeat}
                    onChange={setRepeat}
                    anchorLocal={repeatAnchorLocal}
                    labelClassName="sr-only"
                    fieldClassName={`${quietFieldClass} inline-flex items-center justify-between gap-1`}
                  />
                </FieldRow>
              )}

              {/* Timesheet — hidden for all-day and repeating events, which
                  have nothing for hours to attach to. */}
              {eventCanLogWork && timesheetSection}

              {/* Error from fetcher */}
              {eventFetcher.data?.error && (
                <p className="text-sm text-red-600">{eventFetcher.data.error}</p>
              )}

              {/* Submit */}
              <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitEvent || eventFetcher.state !== "idle"}
                  className="inline-flex items-center gap-1.5 rounded-full bg-os-accent px-6 py-2 text-sm font-semibold text-os-bg hover:bg-os-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {eventFetcher.state !== "idle" ? "Creating…" : "Create event"}
                </button>
              </div>
            </eventFetcher.Form>
          ) : (
            /* ── Meeting form ────────────────────────────────────────────── */
            <form onSubmit={submitMeeting} className="flex flex-col gap-5">
              {/* Title */}
              <div>
                <label htmlFor="cem-mtg-title" className={labelClass}>
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="cem-mtg-title"
                  type="text"
                  required
                  placeholder="e.g. Deserto sync"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {/* Guests */}
              <FieldRow icon={UsersRound}>
                <ParticipantPicker
                  users={data.users}
                  groups={data.groups}
                  selectedUserIds={selectedUserIds}
                  selectedGroupIds={selectedGroupIds}
                  onChangeUsers={setSelectedUserIds}
                  onChangeGroups={setSelectedGroupIds}
                  usersById={usersById}
                  groupsById={groupsById}
                  resolvedCount={resolvedParticipantIds.length}
                  guestEmails={guestEmails}
                  onChangeGuestEmails={inviteDests.length > 0 ? setGuestEmails : undefined}
                />
              </FieldRow>

              {/* Date & Time */}
              <div>
                <label className={labelClass}>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> When
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <DateField
                    mode="date"
                    value={date}
                    onChange={pickDate}
                    ariaLabel="Date"
                    className="min-w-[130px]"
                  />
                  <TimeComboField
                    value={startTime}
                    onChange={(v) => setStartTime(v)}
                    aria-label="Start time"
                    className="w-[110px]"
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <TimeComboField
                    value={endTime}
                    onChange={(v) => setEndTime(v)}
                    aria-label="End time"
                    className="w-[110px]"
                  />
                </div>
                {!startEndValid && (
                  <p className="mt-1 text-xs text-red-600">End must be after start.</p>
                )}
              </div>

              {/* Repeat. A meeting series is anchored to its start, not to the
                  all-day range — this form has no all-day mode. */}
              <RepeatField
                value={repeat}
                onChange={setRepeat}
                anchorLocal={selectedStartLocal}
                labelClassName={labelClass}
                fieldClassName={fieldClass}
              />

              {/* Send invite from */}
              {inviteDests.length > 0 && (
                <div>
                  <label className={labelClass}>Send invite from</label>
                  <Select
                    value={inviteFrom}
                    onChange={(v) => setInviteFrom(v)}
                    options={inviteDests}
                    buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1`}
                  />
                </div>
              )}

              {/* Google Meet */}
              {inviteDests.length > 0 && (
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <Toggle
                    checked={canAddMeet && addMeet}
                    disabled={!canAddMeet}
                    onChange={(e) => setAddMeet(e.target.checked)}
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <Video className="h-3.5 w-3.5" /> Add Google Meet
                      </span>
                    }
                    description={
                      canAddMeet
                        ? "Generates a Meet link on the selected calendar and includes it in the invite."
                        : "Pick a Google calendar to send from and add guests to enable a Meet link."
                    }
                  />
                </div>
              )}

              {/* Location */}
              <div>
                <label htmlFor="cem-mtg-location" className={labelClass}>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Location
                  </span>
                </label>
                <input
                  id="cem-mtg-location"
                  type="text"
                  placeholder="Video call, room, or address"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {roomBooking && (
                <div>
                  <span className={labelClass}>
                    <span className="inline-flex items-center gap-1">
                      <DoorOpen className="h-3 w-3" /> Rooms
                    </span>
                  </span>
                  <RoomPicker
                    enabled={roomBooking}
                    value={roomIds}
                    onChange={(ids, rooms) => {
                      setRoomIds(ids);
                      if (rooms.length && !location.trim()) setLocation(rooms.map((r) => r.name).join(", "));
                    }}
                    className={fieldClass}
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label htmlFor="cem-mtg-description" className={labelClass}>
                  <span className="inline-flex items-center gap-1">
                    <AlignLeft className="h-3 w-3" /> Description
                  </span>
                </label>
                <textarea
                  id="cem-mtg-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add description"
                  rows={2}
                  className={cn(fieldClass, "resize-y")}
                />
              </div>

              {/* Core meeting (Core only) */}
              {data.canMarkCoreMeeting && (
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <Toggle
                    checked={coreSelected || coreMeeting}
                    disabled={coreSelected}
                    onChange={(e) => setCoreMeeting(e.target.checked)}
                    label="Core meeting"
                    description={
                      coreSelected
                        ? "The Core group is invited, so this is already on the Core calendar."
                        : "Adds this to the Core hub calendar. Doesn't change who's invited."
                    }
                  />
                </div>
              )}

              {/* Meeting assets: a note doc and/or a whiteboard, sharing the
                  same About/type. The fields appear once either is enabled. */}
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <Toggle
                  checked={note.state.enabled}
                  onChange={(e) => note.setEnabled(e.target.checked)}
                  label="Create meeting note"
                  description="Starts a shared note doc linked to this meeting."
                />
                <div className="mt-3">
                  <Toggle
                    checked={note.state.whiteboard}
                    onChange={(e) => note.setWhiteboard(e.target.checked)}
                    label="Create whiteboard"
                    description="Starts a shared whiteboard canvas linked to this meeting."
                  />
                </div>
                {(note.state.enabled || note.state.whiteboard) && (
                  <div className="mt-3 pt-1">
                    <MeetingNoteFields
                      note={note}
                      myProjects={data.myProjects}
                      fieldClass={fieldClass}
                      labelClass={labelClass}
                      core={isCoreMeeting}
                    />
                  </div>
                )}
              </div>

              {/* Timesheet — a repeating meeting logs its first occurrence. */}
              {timesheetSection}

              {/* Status */}
              {meetingStatus?.ok === true && (
                <p className="text-sm text-green-700">
                  Meeting created. Notified {meetingStatus.count} participant
                  {meetingStatus.count === 1 ? "" : "s"}.
                  {meetingStatus.notePageId && (
                    <>
                      {" "}
                      <a href={`/documents/${meetingStatus.notePageId}`} className="underline font-medium">
                        View meeting note
                      </a>
                    </>
                  )}
                  {meetingStatus.whiteboardPageId && (
                    <>
                      {" "}
                      <a
                        href={`/whiteboard/${meetingStatus.whiteboardPageId}`}
                        className="underline font-medium"
                      >
                        View whiteboard
                      </a>
                    </>
                  )}
                </p>
              )}
              {meetingStatus?.ok === false && (
                <p className="text-sm text-red-600">{meetingStatus.error}</p>
              )}

              {/* Submit */}
              <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitMeeting}
                  className="inline-flex items-center gap-1.5 rounded-full bg-os-accent px-6 py-2 text-sm font-semibold text-os-bg hover:bg-os-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "Creating…" : "Create meeting"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
