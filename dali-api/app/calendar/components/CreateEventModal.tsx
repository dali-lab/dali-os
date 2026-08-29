import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { AlignLeft, ChevronLeft, ChevronRight, Clock, MapPin, Repeat, UsersRound, X } from "lucide-react";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { TimeField as TimeComboField } from "~/components/ui/TimeField";
import { Select } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import {
  ScheduleWeekGrid,
  ParticipantPicker,
} from "~/calendar/components/scheduling";
import {
  NO_REPEAT,
  RepeatField,
  repeatSpecToRRule,
  type RepeatSpec,
} from "~/calendar/components/RepeatField";
import { eventDestinations, addDaysToDate } from "~/calendar/components/composer";
import { shiftWeekParam, durationMinutesBetween } from "~/calendar/lib/event-block";
import type { LoaderData } from "~/calendar/lib/types";

// ── Props ──────────────────────────────────────────────────────────────────

export type CreateEventModalProps = {
  data: LoaderData;
  startLocal?: string;
  endLocal?: string;
  onClose: () => void;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function weekLabel(weekStartIso: string, timezone: string): string {
  const start = new Date(weekStartIso);
  // Display the 7-day range Sun – Sat
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...opts }).format(d);
  const startMonth = fmt(start, { month: "short" });
  const endMonth = fmt(end, { month: "short" });
  const startDay = fmt(start, { day: "numeric" });
  const endDay = fmt(end, { day: "numeric" });
  if (startMonth === endMonth) return `${startMonth} ${startDay} – ${endDay}`;
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
}

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

// ── Component ──────────────────────────────────────────────────────────────

export function CreateEventModal({
  data,
  startLocal: initStart,
  endLocal: initEnd,
  onClose,
}: CreateEventModalProps) {
  // ── Destination (writable Google calendars) ──────────────────────────────
  const dests = eventDestinations(data);
  const defaultDest =
    data.defaultEventDest && dests.some((d) => d.value === data.defaultEventDest)
      ? data.defaultEventDest
      : dests[0]?.value ?? "";
  const hasWritableDest = dests.length > 0;

  // ── Core form state ──────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string>(() => extractDate(initStart ?? ""));
  const [startTime, setStartTime] = useState<string>(() => extractTime(initStart ?? ""));
  const [endTime, setEndTime] = useState<string>(() => extractTime(initEnd ?? ""));
  const [location, setLocation] = useState("");
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
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

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

  const hasGuests = selectedUserIds.length > 0 || selectedGroupIds.length > 0;
  const type = hasGuests ? "Meeting" : "Event";

  // ── Meeting note fields (only shown in Meeting mode) ─────────────────────
  const [createNote, setCreateNote] = useState(false);
  const [meetingType, setMeetingType] = useState<"Team" | "Partner" | "Other">("Other");
  const [meetingTypeLabel, setMeetingTypeLabel] = useState("");
  const [projectId, setProjectId] = useState("");

  const googleLinks = data.calendarLinks.filter((l) => l.provider === "Google" && l.enabled);
  const [organizerCalendarLinkId, setOrganizerCalendarLinkId] = useState<string>(
    googleLinks[0]?.id ?? "",
  );

  // ── Week navigation for the left panel ───────────────────────────────────
  const [weekStartIso, setWeekStartIso] = useState(data.weekStartIso);
  const weekEndIso = new Date(new Date(weekStartIso).getTime() + 7 * 86_400_000).toISOString();

  // ── Slot selected from the availability grid ─────────────────────────────
  const handleSelectRange = (s: string, e: string) => {
    // s and e are "YYYY-MM-DDTHH:mm" local strings from the grid
    setDate(extractDate(s));
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
  const [meetingStatus, setMeetingStatus] = useState<
    | null
    | { ok: true; count: number; gcalError?: string | null; notePageId?: string | null }
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

  // ── canSubmit ────────────────────────────────────────────────────────────
  const canSubmitEvent =
    title.trim() !== "" &&
    destination !== "" &&
    startIso !== "" &&
    endIso !== "" &&
    startEndValid &&
    startIso < endIso &&
    (!isWork || (roleKey !== "" && workNote.trim() !== ""));

  const canSubmitMeeting =
    title.trim() !== "" &&
    durationMinutes > 0 &&
    startEndValid &&
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
      if (selectedStartLocal) {
        const d = new Date(selectedStartLocal);
        if (!isNaN(d.getTime())) payload.startTime = d.toISOString();
      }
      if (organizerCalendarLinkId) payload.organizerCalendarLinkId = organizerCalendarLinkId;
      if (createNote) {
        payload.meetingType = meetingType;
        if (meetingType === "Other") payload.meetingTypeLabel = meetingTypeLabel.trim();
        if (projectId) payload.projectId = projectId;
      }
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
        setTimeout(() => onClose(), 1200);
      }
    } catch (err) {
      setMeetingStatus({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/40";
  const labelClass = "block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1";

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
  // Rendered identically in both Event and Meeting modes. Extracted to avoid
  // duplication and to keep the toggle/role/workNote wiring in one place.
  const timesheetSection = (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <Toggle
        checked={isWork}
        onChange={(e) => {
          setIsWork(e.target.checked);
          if (!e.target.checked) {
            setRoleKey("");
            setWorkNote("");
          }
        }}
        label="Count this as work"
        description="Automatically logs this event to your Timesheet once it's created."
      />
      {isWork && (
        <div className="mt-3 space-y-3">
          {data.myRoles.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Role — which role you're hired for this time counts toward
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.myRoles.map((r) => {
                  const key = `${r.assignmentType}::${r.roleRefId}`;
                  const active = roleKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRoleKey(active ? "" : key)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
                        active
                          ? "bg-accent-coral text-white border-accent-coral"
                          : "border-border bg-background text-foreground hover:bg-muted",
                      )}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              What did you work on? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={workNote}
              onChange={(e) => setWorkNote(e.target.value)}
              placeholder="Briefly describe what you worked on…"
              rows={2}
              className={cn(fieldClass, "resize-y")}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleOverlayClick}
    >
      <div
        className={cn(
          "relative z-10 flex w-full flex-row overflow-hidden rounded-xl border border-border bg-card shadow-brand-3 max-h-[90vh]",
          hasGuests ? "max-w-4xl" : "max-w-lg",
        )}
      >
        {/* ── Left panel: availability grid — only shown once there are guests
            (a solo event has no availability worth previewing). ───────────── */}
        {hasGuests && (
        <div className="flex w-[42%] shrink-0 flex-col gap-3 border-r border-border bg-muted/20 p-4">
          {/* Week nav */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekStartIso(shiftWeekParam(weekStartIso, -1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="flex-1 text-center text-sm font-medium text-foreground">
              {weekLabel(weekStartIso, data.timezone)}
            </span>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => setWeekStartIso(shiftWeekParam(weekStartIso, 1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Availability grid — compact + no self-only tint when no guests */}
          <div className="min-h-0 flex-1 overflow-hidden">
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
            />
          </div>

          {/* Caption */}
          <div className="text-center">
            <p className="text-xs font-medium text-muted-foreground">Availability for this time</p>
            {availCaption && (
              <p className="mt-0.5 text-xs text-muted-foreground/70">{availCaption}</p>
            )}
          </div>
        </div>
        )}

        {/* ── Right panel: form ──────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  type === "Meeting"
                    ? "border-accent-teal/30 bg-accent-teal/10 text-accent-teal"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {type}
              </span>
              <h2 className="font-heading text-base font-semibold text-foreground">
                Create {type === "Meeting" ? "meeting" : "event"}
              </h2>
            </div>
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
            <eventFetcher.Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="event-create" />
              <input type="hidden" name="destination" value={destination} />
              <input type="hidden" name="startIso" value={startIso} />
              <input type="hidden" name="endIso" value={endIso} />
              <input type="hidden" name="allDay" value={allDay ? "1" : ""} />
              <input type="hidden" name="timeZone" value={data.timezone} />
              <input type="hidden" name="recurrenceRule" value={repeatSpecToRRule(repeat, repeatAnchorLocal) ?? ""} />
              <input type="hidden" name="description" value={description} />
              {isWork && roleKey && (
                <>
                  <input type="hidden" name="isWork" value="1" />
                  <input type="hidden" name="assignmentType" value={roleKey.split("::")[0] ?? ""} />
                  <input type="hidden" name="roleRefId" value={roleKey.split("::")[1] ?? ""} />
                  <input type="hidden" name="workNote" value={workNote.trim()} />
                </>
              )}

              {/* Title */}
              <div>
                <label htmlFor="cem-title" className={labelClass}>
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="cem-title"
                  name="title"
                  type="text"
                  required
                  placeholder="e.g. Deserto sync"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {/* Guests */}
              <div>
                <label className={labelClass}>
                  <span className="inline-flex items-center gap-1">
                    <UsersRound className="h-3 w-3" /> Guests
                  </span>
                </label>
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
                />
              </div>

              {/* Date & Time — all-day toggle + date/time inputs */}
              <div>
                <label className={labelClass}>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> When
                  </span>
                </label>
                {/* All-day toggle */}
                <label className="mb-2 flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={allDay} onChange={() => setAllDay((v) => !v)} /> All day
                </label>
                {allDay ? (
                  /* All-day: start date → end date */
                  <div className="flex items-center gap-2 text-sm">
                    <DateField
                      mode="date"
                      value={dStart}
                      onChange={setDStart}
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
                  <div className="flex flex-wrap items-center gap-2">
                    <DateField
                      mode="date"
                      value={date}
                      onChange={(v) => setDate(v)}
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
                )}
                {!startEndValid && (
                  <p className="mt-1 text-xs text-red-600">
                    {allDay ? "End date must not be before start date." : "End must be after start."}
                  </p>
                )}
              </div>

              {/* Destination calendar — always shown (single-dest falls through as hidden) */}
              <div>
                <label className={labelClass}>Calendar</label>
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
              </div>

              {/* Location */}
              <div>
                <label htmlFor="cem-location" className={labelClass}>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Location
                  </span>
                </label>
                <input
                  id="cem-location"
                  name="location"
                  type="text"
                  placeholder="Video call, room, or address"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="cem-description" className={labelClass}>
                  <span className="inline-flex items-center gap-1">
                    <AlignLeft className="h-3 w-3" /> Description
                  </span>
                </label>
                <textarea
                  id="cem-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add description"
                  rows={2}
                  className={cn(fieldClass, "resize-y")}
                />
              </div>

              {/* Repeat / recurrence — hidden for all-day (Google doesn't support RRULE on all-day events via this flow) */}
              {!allDay && (
                <div>
                  <label className={labelClass}>
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="h-3 w-3" /> Repeat
                    </span>
                  </label>
                  <RepeatField
                    value={repeat}
                    onChange={setRepeat}
                    anchorLocal={repeatAnchorLocal}
                    labelClassName="sr-only"
                    fieldClassName={`${fieldClass} inline-flex items-center justify-between gap-1`}
                  />
                </div>
              )}

              {/* Timesheet */}
              {timesheetSection}

              {/* Error from fetcher */}
              {eventFetcher.data?.error && (
                <p className="text-sm text-red-600">{eventFetcher.data.error}</p>
              )}

              {/* Submit */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!canSubmitEvent || eventFetcher.state !== "idle"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-4 py-2 text-sm font-semibold text-white hover:bg-accent-coral-light disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {eventFetcher.state !== "idle" ? "Creating…" : "Create event"}
                </button>
              </div>
            </eventFetcher.Form>
          ) : (
            /* ── Meeting form ────────────────────────────────────────────── */
            <form onSubmit={submitMeeting} className="flex flex-col gap-4">
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
              <div>
                <label className={labelClass}>
                  <span className="inline-flex items-center gap-1">
                    <UsersRound className="h-3 w-3" /> Guests
                  </span>
                </label>
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
                />
              </div>

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
                    onChange={(v) => setDate(v)}
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

              {/* Send invite from */}
              {googleLinks.length > 0 && (
                <div>
                  <label className={labelClass}>Send invite from</label>
                  <Select
                    value={organizerCalendarLinkId}
                    onChange={(v) => setOrganizerCalendarLinkId(v)}
                    options={googleLinks.map((l) => ({
                      value: l.id,
                      label: l.displayName ? `${l.displayName} — ${l.externalEmail}` : l.externalEmail,
                    }))}
                    buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1`}
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

              {/* Meeting notes toggle */}
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <Toggle
                  checked={createNote}
                  onChange={(e) => setCreateNote(e.target.checked)}
                  label="Create meeting notes"
                  description="Starts a shared notes doc linked to this meeting."
                />
                {createNote && (
                  <div className="mt-3 space-y-3 pt-1">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Meeting type</label>
                        <Select
                          value={meetingType}
                          onChange={(v) => setMeetingType(v as typeof meetingType)}
                          options={[
                            { value: "Team", label: "Team meeting" },
                            { value: "Partner", label: "Partner meeting" },
                            { value: "Other", label: "Other" },
                          ]}
                          buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1`}
                        />
                      </div>
                      {meetingType === "Other" && (
                        <div>
                          <label className={labelClass}>Meeting type name</label>
                          <input
                            type="text"
                            value={meetingTypeLabel}
                            onChange={(e) => setMeetingTypeLabel(e.target.value)}
                            placeholder="e.g. Partner hub meeting"
                            className={fieldClass}
                          />
                        </div>
                      )}
                      <div className={meetingType === "Other" ? "sm:col-span-2" : ""}>
                        <label className={labelClass}>
                          Project <span className="text-muted-foreground font-normal">(optional)</span>
                        </label>
                        <Select
                          value={projectId}
                          onChange={(v) => setProjectId(v)}
                          options={[
                            { value: "", label: "No project — Lab documents" },
                            ...data.myProjects.map((p) => ({ value: p.id, label: p.name })),
                          ]}
                          buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1`}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Timesheet */}
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
                </p>
              )}
              {meetingStatus?.ok === false && (
                <p className="text-sm text-red-600">{meetingStatus.error}</p>
              )}

              {/* Submit */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!canSubmitMeeting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-4 py-2 text-sm font-semibold text-white hover:bg-accent-coral-light disabled:opacity-50 disabled:cursor-not-allowed"
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
