import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Calendar as CalendarIcon, Clock, X, GripVertical, Repeat, MapPin, AlignLeft, UsersRound, Video } from "lucide-react";
import { AnchoredCard } from "~/components/ui/floating/AnchoredCard";
import { DateField } from "~/components/ui/DateField";
import { TimeField as TimeComboField } from "~/components/ui/TimeField";
import { Select } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { Checkbox } from "~/components/ui/Checkbox";
import { roleOptionKey, parseRoleOptionKey } from "~/calendar/components/role-fields";
import { TimesheetFields } from "~/calendar/components/TimesheetFields";
import { ParticipantPicker } from "~/calendar/components/scheduling";
import type { EditContext } from "~/calendar/components/EditMeetingModal";
import {
  NO_REPEAT,
  RepeatField,
  repeatSpecToRRule,
  type RepeatSpec,
} from "~/calendar/components/RepeatField";
import { cn } from "~/lib/cn";
import { localDayTimeToIso } from "~/calendar/lib/event-block";
import { eventTitleOrDefault } from "~/calendar/lib/event-title";
import { useSubmitBackground } from "~/calendar/lib/background-submissions";
import { isTrackedMeeting, STOP_TRACKING_DESCRIPTION, STOP_TRACKING_LABEL } from "~/calendar/lib/stop-tracking";
import type { LoaderData, ExternalEventDTO } from "~/calendar/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────
import { isoToZonedFields, isoToDateInput, addDaysToDate, eventDestinations } from "~/calendar/lib/composer-fields";

export type ComposerState =
  // anchor is the on-screen rect of the clicked event / dragged slot / New
  // button, so the composer pops up next to it (Google-Calendar style) rather
  // than as a centered full-screen modal. Null → centered fallback. seed
  // prefills a create from an existing event (Duplicate) — its identity fields
  // (eventId/manualBlockId) are ignored, so it saves as a brand-new event.
  | { mode: "create"; startLocal?: string; endLocal?: string; anchor?: DOMRect | null; seed?: ExternalEventDTO }
  | { mode: "edit"; event: ExternalEventDTO; anchor?: DOMRect | null };

// ── SearchResponse type ────────────────────────────────────────────────────

export function EventComposer({
  data,
  state,
  onClose,
  onDraftChange,
  onOpenMeetingEditor,
}: {
  data: LoaderData;
  state: ComposerState;
  onClose: () => void;
  // Reports the draft's current start/end while creating, so the grid can draw
  // a tentative block that tracks the edits.
  onDraftChange?: (startIso: string, endIso: string, allDay: boolean) => void;
  // Opens the full meeting editor (with the availability grid) for a DALI
  // meeting the viewer manages.
  onOpenMeetingEditor?: (meetingId: string) => void;
}) {
  const submitBackground = useSubmitBackground();
  const instanceId = useId();
  const dialog = useDialog();
  const [steppedAside, setSteppedAside] = useState(false);
  const editing = state.mode === "edit";
  const ev = editing ? state.event : null;
  // Prefill source: the event being edited, or a Duplicate seed in create mode.
  // Identity (eventId/manualBlockId/recurringEventId) stays on `ev` so a
  // duplicate saves as a brand-new event; `base` only drives the field values.
  const base = ev ?? (state.mode === "create" ? state.seed ?? null : null);
  const dests = eventDestinations(data);

  // When the edited event is a DALI meeting the viewer manages, this composer is
  // its full editor: it grows a guest list and saves through the meeting's own
  // update path (roster + notifications + Google sync) rather than a raw Google
  // patch — see maybeUpdateMeetingFromComposer on the server.
  const meetingId = editing ? ev?.meeting?.meetingId ?? null : null;
  const canManageMeeting = Boolean(meetingId && ev?.meeting?.canInvite);
  const tracked = isTrackedMeeting(ev?.meeting);

  const [title, setTitle] = useState(base?.title ?? "");
  const [allDay, setAllDay] = useState(base?.allDay ?? false);
  const [destination, setDestination] = useState(() => {
    if (base?.linkId && base.calendarId) return `${base.linkId}:${base.calendarId}`;
    if (data.defaultEventDest && dests.some((d) => d.value === data.defaultEventDest)) return data.defaultEventDest;
    return dests[0]?.value ?? "";
  });
  const [location, setLocation] = useState(base?.location ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  // A recurring instance carries recurringEventId; editing it prompts for scope.
  const isRecurring = Boolean(ev?.recurringEventId);
  const [scope, setScope] = useState<"this" | "following" | "all">("this");
  // Saving a single event, one occurrence, or a new event changes nothing but
  // that block, so the form closes on submit and the grid draws the change
  // while it saves. Editing a whole series or "this & following" splits it into
  // new events whose ids only exist once the server answers, so those wait.
  const closeOnSubmit = !editing || !isRecurring || scope === "this";
  const fetcher = useFetcher<{ error?: string } | null>({ key: `cal:fg:${instanceId}` });

  // Guest list, loaded on demand for a meeting edit (mirrors EditMeetingModal).
  const [guestCtx, setGuestCtx] = useState<EditContext | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [guestEmails, setGuestEmails] = useState<string[]>([]);

  // ── Count this as work ──────────────────────────────────────────────────
  // An event's hours are part of the event, not a separate thing to manage in
  // a separate modal: this section IS the timesheet entry, and the grid shows
  // it as a role accent on the event's own block. Editing prefills from the
  // linked entry; unticking deletes it server-side and leaves the event.
  // A Duplicate seed deliberately doesn't carry the log — the copy is a new
  // event and hasn't been worked yet.
  const linkedEntry =
    (editing && ev?.eventId && data.timeEntries.find((t) => t.sourceEventId === ev.eventId)) || null;
  const [isWork, setIsWork] = useState(Boolean(linkedEntry));
  const [roleKey, setRoleKey] = useState(() => {
    if (linkedEntry?.assignmentType && linkedEntry.roleRefId) {
      return roleOptionKey({ assignmentType: linkedEntry.assignmentType, roleRefId: linkedEntry.roleRefId });
    }
    return data.myRoles.length === 1 ? roleOptionKey(data.myRoles[0]!) : "";
  });
  const [workNote, setWorkNote] = useState(linkedEntry?.note ?? "");
  // Hours hang off one concrete, timed occurrence: a repeating event has no
  // single occurrence to attach them to, and an all-day event has no range to
  // measure. The server enforces the same rule.
  // Hours attach to a calendar the viewer owns; a meeting they manage but can't
  // write (Core editing another's meeting) can't carry the viewer's log here.
  const canLogWork =
    data.myRoles.length > 0 && !isRecurring && !allDay && !(canManageMeeting && !ev?.writable);
  const loggingWork = canLogWork && isWork;
  const role = parseRoleOptionKey(roleKey);

  // A writable Google event saved without a Meet link can mint one here. DALI
  // meetings and manual blocks manage their video link elsewhere.
  const canAddMeet =
    editing &&
    !!ev?.writable &&
    !!ev?.eventId &&
    !ev?.manualBlockId &&
    !canManageMeeting &&
    !ev?.links?.some((l) => l.kind === "video");
  const [addMeet, setAddMeet] = useState(false);

  // Timed inputs are split into one date + start/end times (custom DateField /
  // TimeField), seeded as wall-clock in the user's timezone (the grid's) so the
  // composer and the on-grid block agree even when the browser timezone differs.
  // The drag seed (state.startLocal, "yyyy-MM-ddThh:mm") is already wall-clock.
  const seedTimed =
    base && !base.allDay
      ? { start: isoToZonedFields(base.startIso, data.timezone), end: isoToZonedFields(base.endIso, data.timezone) }
      : null;
  const createSeed = state.mode === "create" ? { s: state.startLocal, e: state.endLocal } : null;
  const initStart = seedTimed?.start ?? { date: createSeed?.s?.slice(0, 10) ?? "", time: createSeed?.s?.slice(11, 16) ?? "" };
  const initEnd = seedTimed?.end ?? { date: createSeed?.e?.slice(0, 10) ?? "", time: createSeed?.e?.slice(11, 16) ?? "" };
  const [date, setDate] = useState(initStart.date);
  const [startTime, setStartTime] = useState(initStart.time);
  const [endTime, setEndTime] = useState(initEnd.time);
  const [dStart, setDStart] = useState(base?.allDay ? isoToDateInput(base.startIso) : initStart.date);
  const [dEnd, setDEnd] = useState(
    base?.allDay ? addDaysToDate(isoToDateInput(base.endIso), -1) : initEnd.date,
  );

  // A save that waits for the server (a series edit) closes once it succeeds.
  const prev = useRef(fetcher.state);
  useEffect(() => {
    if (prev.current !== "idle" && fetcher.state === "idle" && !fetcher.data?.error) onClose();
    prev.current = fetcher.state;
  }, [fetcher.state, fetcher.data, onClose]);

  // Load the meeting's guest list + member/group directory once, then seed the
  // picker. A Group-scoped meeting keeps its group selected and treats anyone
  // invited on top as extra guests — same split the Attendance-tab editor uses.
  useEffect(() => {
    if (!canManageMeeting || !meetingId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scheduled-meetings/${meetingId}/edit-context`, {
          credentials: "include",
        });
        const json = await res.json();
        if (cancelled || !res.ok) return;
        const ctx = json as EditContext;
        if (ctx.meeting.scopeType === "Group" && ctx.meeting.groupId) {
          const members = new Set(
            ctx.options.groups.find((g) => g.id === ctx.meeting.groupId)?.memberIds ?? [],
          );
          setSelectedGroupIds([ctx.meeting.groupId]);
          setSelectedUserIds(ctx.meeting.participantUserIds.filter((id) => !members.has(id)));
        } else {
          setSelectedUserIds(ctx.meeting.participantUserIds);
          setSelectedGroupIds([]);
        }
        setGuestEmails(ctx.meeting.guestEmails);
        setGuestCtx(ctx);
      } catch {
        // Leave the picker in its loading state; saving is blocked until it loads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManageMeeting, meetingId]);

  const guestUsersById = useMemo(
    () => new Map((guestCtx?.options.users ?? []).map((u) => [u.id, u])),
    [guestCtx],
  );
  const guestGroupsById = useMemo(
    () => new Map((guestCtx?.options.groups ?? []).map((g) => [g.id, g])),
    [guestCtx],
  );
  const guestResponses = useMemo(
    () => new Map(Object.entries(guestCtx?.responsesByUserId ?? {})),
    [guestCtx],
  );
  const resolvedParticipantIds = useMemo(() => {
    const set = new Set<string>(selectedUserIds);
    for (const gid of selectedGroupIds) {
      const g = guestGroupsById.get(gid);
      if (g) for (const uid of g.memberIds) set.add(uid);
    }
    return Array.from(set);
  }, [selectedUserIds, selectedGroupIds, guestGroupsById]);
  // Serialized ScheduledMeetingScope the action parses back (parseMeetingScope):
  // one group + extras stays group-scoped; otherwise a flat list, or none.
  const meetingScope = useMemo(() => {
    if (selectedGroupIds.length === 1) {
      return {
        type: "Group" as const,
        groupId: selectedGroupIds[0],
        ...(selectedUserIds.length > 0 ? { extraUserIds: selectedUserIds } : {}),
      };
    }
    if (resolvedParticipantIds.length > 0) {
      return { type: "UserList" as const, participantUserIds: resolvedParticipantIds };
    }
    return { type: "None" as const };
  }, [selectedGroupIds, selectedUserIds, resolvedParticipantIds]);

  // Derived hidden values. Timed events use one date + start/end times; an end
  // that's earlier than the start is read as crossing midnight (next day). Times
  // are interpreted in the user's timezone (data.timezone) via localDayTimeToIso
  // — NOT the browser's — so a typed "9:00" lands where the grid draws 9:00.
  const startLocalDT = date && startTime ? `${date}T${startTime}` : ""; // RepeatField anchor
  const endDate = date && startTime && endTime && endTime < startTime ? addDaysToDate(date, 1) : date;
  const startIso = allDay
    ? dStart
      ? `${dStart}T00:00:00.000Z`
      : ""
    : date && startTime
      ? localDayTimeToIso(date, startTime, data.timezone) ?? ""
      : "";
  const endIso = allDay
    ? dEnd
      ? `${addDaysToDate(dEnd, 1)}T00:00:00.000Z` // Google end is exclusive
      : ""
    : endDate && endTime
      ? localDayTimeToIso(endDate, endTime, data.timezone) ?? ""
      : "";
  const canSubmit =
    destination !== "" &&
    startIso !== "" &&
    endIso !== "" &&
    startIso < endIso &&
    // Logged hours are payroll data — they need a role to attribute to and a
    // note saying what the time went on, same as every other way of logging.
    (!loggingWork || (Boolean(role) && workNote.trim() !== "")) &&
    // Don't let a meeting save before its guest list has loaded — an empty
    // selection would otherwise be read as "remove everyone".
    (!canManageMeeting || guestCtx !== null);
  // A meeting the viewer manages is editable even when its Google copy isn't
  // theirs to write — the save routes through the DALI update path.
  const canEdit = Boolean(ev?.writable) || canManageMeeting;
  const submitting = fetcher.state !== "idle";

  // A recurring event's scope selector decides how much goes, so the confirm
  // restates it rather than leaving the reader to remember which radio is set.
  async function confirmDeleteEvent() {
    if (!ev?.eventId) return;
    const effectiveScope = isRecurring ? scope : "this";
    setSteppedAside(true);
    const ok = await dialog.confirm({
      title: title.trim()
        ? `${tracked ? STOP_TRACKING_LABEL : "Delete"} "${title.trim()}"?`
        : tracked
          ? "Stop tracking this meeting?"
          : "Delete this event?",
      description: tracked
        ? STOP_TRACKING_DESCRIPTION
        : !isRecurring
        ? canManageMeeting
          ? "The meeting is cancelled and guests are told. This can't be undone."
          : "The event is removed from the calendar. This can't be undone."
        : effectiveScope === "all"
          ? "Every occurrence of this repeating event is deleted, past and future."
          : effectiveScope === "following"
            ? "This occurrence and every one after it are deleted. Earlier ones stay."
            : "Only this occurrence is deleted. The rest of the series stays.",
      confirmLabel: tracked ? STOP_TRACKING_LABEL : "Delete",
      tone: "destructive",
    });
    if (!ok) {
      setSteppedAside(false);
      return;
    }
    submitBackground("event-delete", {
      intent: "event-delete",
      destination,
      eventId: ev.eventId ?? "",
      scope: effectiveScope,
      recurringEventId: ev.recurringEventId ?? "",
      originalStartIso: ev.startIso ?? "",
    });
    onClose();
  }

  // Report the draft times to the grid so the live preview (a tentative block
  // when creating, or the edited event's own block when editing) tracks edits.
  useEffect(() => {
    onDraftChange?.(startIso, endIso, allDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIso, endIso, allDay]);

  const fieldCls = "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

  return (
    <AnchoredCard
      anchor={state.anchor}
      onClose={onClose}
      draggable
      ariaLabel={editing ? "Edit event" : "New event"}
      className={cn(
        "w-[23rem] max-h-[85vh] overflow-y-auto rounded-xl cal-surface",
        // Steps aside (keeping its state) while the delete confirm is up.
        steppedAside && "invisible",
      )}
    >
        {/* Header — doubles as the drag handle (grab anywhere but the close X).
            Sticky + opaque so it stays grabbable if the form scrolls. */}
        <div
          data-drag-handle
          className="sticky top-0 z-10 flex cursor-move select-none items-center justify-between rounded-t-xl border-b border-border bg-muted px-4 py-2.5"
        >
          <div className="flex items-center gap-1.5">
            <GripVertical className="h-4 w-4 text-muted-foreground/50" />
            <h2 className="font-heading text-sm font-semibold text-foreground">{editing ? "Edit event" : "New event"}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {dests.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            Connect a Google Calendar you can write to first (Settings → Calendar).
          </p>
        ) : (
          <fetcher.Form
            method="post"
            onSubmit={(e) => {
              if (!closeOnSubmit) return;
              e.preventDefault();
              submitBackground(editing ? "event-update" : "event-create", new FormData(e.currentTarget));
              onClose();
            }}
            className="flex flex-col gap-3 px-4 py-4"
          >
            <input type="hidden" name="intent" value={editing ? "event-update" : "event-create"} />
            {editing && ev?.eventId && <input type="hidden" name="eventId" value={ev.eventId} />}
            {canManageMeeting && (
              <input type="hidden" name="meetingScope" value={JSON.stringify(meetingScope)} />
            )}
            {canManageMeeting && guestCtx && (
              <input type="hidden" name="guestEmails" value={JSON.stringify(guestEmails)} />
            )}
            <input type="hidden" name="destination" value={destination} />
            <input type="hidden" name="startIso" value={startIso} />
            <input type="hidden" name="endIso" value={endIso} />
            <input type="hidden" name="allDay" value={allDay ? "1" : ""} />
            <input type="hidden" name="timeZone" value={data.timezone} />
            <input type="hidden" name="recurrenceRule" value={!isRecurring ? (repeatSpecToRRule(repeat, allDay ? dStart : startLocalDT) ?? "") : ""} />
            {isRecurring && <input type="hidden" name="scope" value={scope} />}
            {isRecurring && ev?.recurringEventId && (
              <input type="hidden" name="recurringEventId" value={ev.recurringEventId} />
            )}
            {isRecurring && ev?.startIso && <input type="hidden" name="originalStartIso" value={ev.startIso} />}
            {loggingWork && role && (
              <>
                <input type="hidden" name="isWork" value="1" />
                <input type="hidden" name="assignmentType" value={role.assignmentType} />
                <input type="hidden" name="roleRefId" value={role.roleRefId} />
                <input type="hidden" name="workNote" value={workNote.trim()} />
              </>
            )}
            {/* Deleting hours is explicit: only sent when this composer was
                actually showing a log and the user turned it off. Silence means
                "leave the log alone", so a save can't drop payroll data the
                form never knew about. */}
            {linkedEntry && !loggingWork && <input type="hidden" name="clearWork" value="1" />}

            {/* Title */}
            <input type="hidden" name="title" value={eventTitleOrDefault(title)} />
            <input
              aria-label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add title"
              className="rounded-md border border-border bg-background px-3 py-2 text-base font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:border-os-accent focus:outline-none"
              autoFocus
            />

            {/* When — all-day toggle + start/end */}
            <div className="flex items-start gap-3">
              <Clock className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={allDay} onChange={() => setAllDay((v) => !v)} /> All day
                </label>
                {allDay ? (
                  <div className="flex items-center gap-2 text-sm">
                    <DateField mode="date" value={dStart} onChange={setDStart} ariaLabel="Start date" className="min-w-0 flex-1" />
                    <span className="text-muted-foreground">to</span>
                    <DateField mode="date" value={dEnd} onChange={setDEnd} ariaLabel="End date" className="min-w-0 flex-1" />
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 text-sm">
                    <DateField mode="date" value={date} onChange={setDate} ariaLabel="Date" className="w-full" />
                    <div className="flex items-center gap-2">
                      <TimeComboField value={startTime} onChange={setStartTime} ariaLabel="Start time" className="min-w-0 flex-1" />
                      <span className="text-muted-foreground">–</span>
                      <TimeComboField value={endTime} onChange={setEndTime} ariaLabel="End time" className="min-w-0 flex-1" />
                    </div>
                  </div>
                )}
                {/* The popover is too narrow for the availability grid; hand
                    off to the full editor, which draws it beside the form. */}
                {canManageMeeting && meetingId && onOpenMeetingEditor && (
                  <button
                    type="button"
                    onClick={() => onOpenMeetingEditor(meetingId)}
                    className="self-start text-xs font-medium text-os-accent hover:underline"
                  >
                    Pick a time with everyone's availability
                  </button>
                )}
              </div>
            </div>

            {/* Calendar destination */}
            <div className="flex items-center gap-3">
              <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                {editing ? (
                  <span className={cn(fieldCls, "block text-muted-foreground")}>
                    {dests.find((d) => d.value === destination)?.label ?? "This calendar"}
                  </span>
                ) : (
                  <Select
                    value={destination}
                    onChange={setDestination}
                    options={dests}
                    placeholder="Pick a calendar"
                    buttonClassName={cn(fieldCls, "w-full inline-flex items-center justify-between gap-1 text-left hover:bg-muted/40")}
                  />
                )}
              </div>
            </div>

            <div className="my-0.5 border-t border-border/60" />

            {/* Guests — only for a DALI meeting the viewer manages. Editing the
                list here reconciles the roster, notifies added/removed guests,
                and re-syncs the Google event via the meeting update path. */}
            {canManageMeeting && (
              <div className="flex items-start gap-3">
                <UsersRound className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  {guestCtx ? (
                    <ParticipantPicker
                      users={guestCtx.options.users}
                      groups={guestCtx.options.groups}
                      selectedUserIds={selectedUserIds}
                      selectedGroupIds={selectedGroupIds}
                      onChangeUsers={setSelectedUserIds}
                      onChangeGroups={setSelectedGroupIds}
                      usersById={guestUsersById}
                      groupsById={guestGroupsById}
                      resolvedCount={resolvedParticipantIds.length}
                      responsesByUserId={guestResponses}
                      guestEmails={guestEmails}
                      onChangeGuestEmails={guestCtx.meeting.googleSynced ? setGuestEmails : undefined}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">Loading guests…</span>
                  )}
                </div>
              </div>
            )}

            {/* Location */}
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                name="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Add location"
                className={cn(fieldCls, "min-w-0 flex-1")}
              />
            </div>

            {/* Google Meet, for an event saved without one */}
            {canAddMeet && (
              <div className="flex items-center gap-3">
                <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
                {addMeet && <input type="hidden" name="addMeet" value="1" />}
                <Checkbox
                  checked={addMeet}
                  onChange={(e) => setAddMeet(e.target.checked)}
                  label="Add Google Meet"
                  description="Creates a Meet link on this event when you save."
                />
              </div>
            )}

            {/* Description */}
            <div className="flex items-start gap-3">
              <AlignLeft className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <textarea
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add description"
                rows={2}
                className={cn(fieldCls, "min-w-0 flex-1 resize-y")}
              />
            </div>

            {/* Repeat */}
            {isRecurring ? (
              <div className="flex items-start gap-3">
                <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Repeating event — apply to</span>
                  <div className="inline-flex w-fit rounded-md border border-border p-0.5 text-xs">
                    {(["this", "following", "all"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setScope(s)}
                        className={cn(
                          "rounded px-2 py-1",
                          scope === s ? "bg-os-accent text-os-bg" : "text-foreground hover:bg-muted",
                        )}
                      >
                        {s === "this" ? "This event" : s === "following" ? "This & following" : "All events"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : !editing ? (
              <div className="flex items-center gap-3">
                <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <RepeatField
                    value={repeat}
                    onChange={setRepeat}
                    anchorLocal={allDay ? dStart : startLocalDT}
                    labelClassName="sr-only"
                    fieldClassName={cn(fieldCls, "w-full")}
                  />
                </div>
              </div>
            ) : null}

            {/* Timesheet — only when creating: an existing event's hours are
                toggled from the detail popover and edited in the Timesheet
                view, not here. An edit keeps a linked log untouched through
                the hidden inputs above, and only warns when the edit is about
                to invalidate it. */}
            {!editing && canLogWork ? (
              <TimesheetFields
                isWork={isWork}
                onIsWorkChange={setIsWork}
                roleKey={roleKey}
                onRoleKeyChange={setRoleKey}
                roleOptions={data.myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label }))}
                workNote={workNote}
                onWorkNoteChange={setWorkNote}
                description="Logs these hours to your timesheet against the role you pick."
                fieldClass={fieldCls}
              />
            ) : linkedEntry && !canLogWork ? (
              // Editing pushed the event into a shape hours can't hang off (made
              // it all-day, say). Say so rather than silently dropping the log
              // the save is about to clear.
              <p className="text-xs text-os-amber">
                Saving will remove the {linkedEntry.hours}h logged against this event — hours need a
                single event with a start and end time.
              </p>
            ) : null}

            {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}
            {editing && !canEdit && (
              <p className="text-xs text-muted-foreground">This event is read-only.</p>
            )}

            <div className="mt-1 flex items-center gap-2 border-t border-border pt-3">
              <button
                type="submit"
                disabled={!canSubmit || submitting || (editing && !canEdit)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-os-accent px-3 py-1.5 text-sm font-semibold text-os-bg hover:bg-os-accent-hover disabled:opacity-50"
              >
                {editing ? "Save changes" : "Create event"}
              </button>
              {editing && (ev?.writable || canManageMeeting) && ev?.eventId && (
                <div className="ml-auto">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void confirmDeleteEvent()}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {tracked ? STOP_TRACKING_LABEL : "Delete"}
                  </button>
                </div>
              )}
            </div>
          </fetcher.Form>
        )}
    </AnchoredCard>
  );
}

// ── CalendarManagerModal ───────────────────────────────────────────────────
// Create / rename / delete Google calendars on a linked account.
