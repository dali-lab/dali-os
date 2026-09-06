import { useEffect, useRef, useState } from "react";
import { Link, useRevalidator, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Shield, UsersRound, X } from "lucide-react";
import { Tooltip, InfoTip, Select } from "~/components/ui/floating";
import { buttonClasses } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { fullName } from "~/lib/display";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { NO_REPEAT, RepeatField, repeatSpecToRRule, type RepeatSpec } from "~/calendar/components/RepeatField";
import {
  useMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
  MeetingNoteFields,
} from "~/calendar/components/MeetingNoteFields";
import {
  toDatetimeLocal, durationMinutesBetween, HOURS, HOUR_PX, SNAP_HOURS,
  availabilityTint, dayHourToLocal, shiftWeekParam,
} from "~/calendar/lib/event-block";
import {
  WeekGrid, BlockBlock, useRefreshOnFocus, workingHoursStripeLayer,
} from "~/calendar/components/WeekGrid";
import {
  type GroupOption, type UserOption, type GroupAvailResponse, type ProjectOption,
  type CalendarLinkDTO, type WhDay, type EventBlock, type LoaderData,
} from "~/calendar/lib/types";
import { roleOptionKey, parseRoleOptionKey } from "~/calendar/components/role-fields";

export function userLabel(u: UserOption) {
  const name = fullName(u);
  return name || u.daliEmail || u.id;
}

// Scheduling as an on-grid overlay: the group free/busy gradient grid on the
// left (drag to pick a slot), the meeting form docked on the right. Reuses the
// existing ScheduleWeekGrid + CreateScheduledMeetingForm — the same wiring as
// the legacy Schedule tab, re-laid-out to sit beside the grid. Week-scoped
// (scheduling happens within a week); the toolbar's week nav still applies.
export function MeetingComposer({ data }: { data: LoaderData }) {
  const [searchParams] = useSearchParams();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(() => {
    const projectParam = searchParams.get("project");
    if (!projectParam) return [];
    const g = data.groups.find((grp) => grp.projectId === projectParam);
    return g ? [g.id] : [];
  });
  const [startLocal, setStartLocal] = useState<string>("");
  const [endLocal, setEndLocal] = useState<string>("");

  const groupsById = new Map(data.groups.map((g) => [g.id, g]));
  const resolvedParticipantIds = (() => {
    const set = new Set<string>(selectedUserIds);
    for (const gid of selectedGroupIds) {
      const g = groupsById.get(gid);
      if (g) for (const uid of g.memberIds) set.add(uid);
    }
    return Array.from(set);
  })();
  const duration = durationMinutesBetween(startLocal, endLocal);

  return (
    <div className="grid min-w-0 gap-4 lg:min-h-[calc(100vh-11rem)] lg:grid-cols-[1fr_390px]">
      <div className="order-2 min-w-0 lg:order-1">
        <ScheduleWeekGrid
          participantIds={
            resolvedParticipantIds.length > 0
              ? Array.from(new Set([...resolvedParticipantIds, data.currentUserId]))
              : [data.currentUserId]
          }
          showingSelfOnly={resolvedParticipantIds.length === 0}
          users={data.users}
          workingHours={data.workingHours}
          workingHoursEnabled={data.hasPersistedWorkingHours}
          durationMinutes={duration}
          timezone={data.timezone}
          weekStartIso={data.weekStartIso}
          weekEndIso={data.weekEndIso}
          onSelectRange={(s, e) => {
            setStartLocal(s);
            setEndLocal(e);
          }}
          selectedStartLocal={startLocal}
          selectedEndLocal={endLocal}
        />
      </div>
      <aside className="order-1 min-w-0 lg:order-2">
        <CreateScheduledMeetingForm
          groups={data.groups}
          users={data.users}
          calendarLinks={data.calendarLinks}
          myProjects={data.myProjects}
          canSetSelfCheckIn={data.canSetSelfCheckIn}
          startLocal={startLocal}
          onStartLocalChange={setStartLocal}
          endLocal={endLocal}
          onEndLocalChange={setEndLocal}
          selectedUserIds={selectedUserIds}
          onChangeSelectedUserIds={setSelectedUserIds}
          selectedGroupIds={selectedGroupIds}
          onChangeSelectedGroupIds={setSelectedGroupIds}
          resolvedParticipantIds={resolvedParticipantIds}
        />
      </aside>
    </div>
  );
}

export function WeekToolbar({
  legend,
  monthLabel,
  weekStartIso,
  onRefresh,
  refreshing,
}: {
  // `color` is a Tailwind bg-* class; `swatch` is a raw CSS color for tints
  // that are computed at runtime (e.g. the availability gradient stops).
  // Unused today (not rendered in this component's JSX) — kept optional so
  // callers that don't have a color key to show (e.g. Timesheet, which uses
  // RoleFilterRow instead) don't need to pass a placeholder value.
  legend?: { color?: string; swatch?: string; label: string }[];
  monthLabel: string;
  weekStartIso: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { os, iconBtn } = useOsChrome();
  // Use URL-relative resolution so "?weekStart=…" stays on /calendar instead of
  // bubbling up to the parent route (which would land on /).
  const prev = `?weekStart=${shiftWeekParam(weekStartIso, -1)}`;
  const next = `?weekStart=${shiftWeekParam(weekStartIso, 1)}`;
  return (
    <div className={cn("flex items-center justify-between", os ? "mb-5" : "mb-3")}>
      <div className="flex items-center gap-3">
        <h2
          className={cn(
            "font-heading text-foreground",
            os ? "text-2xl font-medium" : "text-lg font-bold",
          )}
        >
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1">
          <Link
            to={prev}
            relative="path"
            aria-label="Previous week"
            preventScrollReset
            className={iconBtn}
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <Link
            to="?"
            relative="path"
            preventScrollReset
            className={cn(
              "text-xs font-semibold transition-colors",
              os
                ? "os-edit-btn os-add-btn--sm"
                : "px-3 py-1 rounded-md border border-border hover:bg-muted",
            )}
          >
            Today
          </Link>
          <Link
            to={next}
            relative="path"
            aria-label="Next week"
            preventScrollReset
            className={iconBtn}
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
          {onRefresh && (
            <Tooltip content={refreshing ? "Refreshing…" : "Refresh availability"}>
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label="Refresh availability"
                className={cn(iconBtn, "disabled:opacity-50")}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

export function CreateScheduledMeetingForm({
  groups,
  users,
  calendarLinks,
  myProjects,
  canSetSelfCheckIn,
  startLocal,
  onStartLocalChange,
  endLocal,
  onEndLocalChange,
  selectedUserIds,
  onChangeSelectedUserIds,
  selectedGroupIds,
  onChangeSelectedGroupIds,
  resolvedParticipantIds,
}: {
  groups: GroupOption[];
  users: UserOption[];
  calendarLinks: CalendarLinkDTO[];
  myProjects: ProjectOption[];
  canSetSelfCheckIn: boolean;
  startLocal: string;
  onStartLocalChange: (v: string) => void;
  endLocal: string;
  onEndLocalChange: (v: string) => void;
  selectedUserIds: string[];
  onChangeSelectedUserIds: (ids: string[]) => void;
  selectedGroupIds: string[];
  onChangeSelectedGroupIds: (ids: string[]) => void;
  resolvedParticipantIds: string[];
}) {
  const { panel, panelPad, formClass } = useOsChrome();
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  const googleLinks = calendarLinks.filter((l) => l.provider === "Google" && l.enabled);
  const [organizerCalendarLinkId, setOrganizerCalendarLinkId] = useState<string>(
    googleLinks[0]?.id ?? "",
  );
  // Meeting notes are opt-in — the About / type / location fields only appear
  // once enabled. See MeetingNoteFields for the derive-type-from-project model.
  const note = useMeetingNote();
  // Self check-in is independent of the meeting note (QR lives on the note when
  // one exists, otherwise on /calendar/check-in/:id).
  const [selfCheckIn, setSelfCheckIn] = useState(false);
  const [status, setStatus] = useState<
    | null
    | {
        ok: true;
        count: number;
        gcalError?: string | null;
        notePageId?: string | null;
        meetingId?: string | null;
        selfCheckIn?: boolean;
      }
    | { ok: false; error: string }
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  // A Core meeting is derived from inviting the Core group (systemKey "core")
  // rather than a manual toggle — so it lands on the Core calendar automatically.
  const coreSelected = selectedGroupIds.some((gid) => groupsById.get(gid)?.systemKey === "core");

  // Prefill "About" when exactly one selected group is a system-managed project
  // group (see GroupOption.projectId) — a default the sender can still change. It
  // fills even while the note is off, so the project is already chosen if they
  // turn it on; it never enables the note itself.
  useEffect(() => {
    if (selectedGroupIds.length !== 1) return;
    note.applyGroupPrefill(groupsById.get(selectedGroupIds[0]!)?.projectId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupIds]);

  // Both pickers filled → derive duration; otherwise fall back to 30 min so
  // "schedule later" (no start/end yet) still produces a valid payload.
  const duration = durationMinutesBetween(startLocal, endLocal);
  const startEndValid =
    !startLocal || !endLocal || new Date(endLocal).getTime() > new Date(startLocal).getTime();
  const meetingTypeValid = meetingNoteValid(note.state);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        durationMinutes: duration,
      };
      const rrule = repeatSpecToRRule(repeat);
      if (rrule) payload.recurrenceRule = rrule;
      if (startLocal) {
        // datetime-local has no timezone; interpret it in the browser's zone
        // and send a real ISO string with offset.
        const localDate = new Date(startLocal);
        if (!isNaN(localDate.getTime())) {
          payload.startTime = localDate.toISOString();
        }
      }
      if (organizerCalendarLinkId) {
        payload.organizerCalendarLinkId = organizerCalendarLinkId;
      }
      Object.assign(payload, meetingNotePayload(note.state));
      if (canSetSelfCheckIn) {
        payload.attendanceMode = selfCheckIn ? "SelfCheckIn" : "Roster";
      }
      if (coreSelected) {
        payload.isCoreMeeting = true;
      }

      // If exactly one group is picked and no extra people are added, record the
      // group scope so notifications carry sourceGroupId. Otherwise submit as UserList.
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
        setStatus({ ok: false, error: json.error ?? "Failed to create meeting" });
      } else {
        setStatus({
          ok: true,
          count: json.notifiedCount ?? 0,
          gcalError: json.gcalError ?? null,
          notePageId: json.notePageId ?? null,
          meetingId: json.meeting?.id ?? null,
          selfCheckIn,
        });
        setTitle("");
        setRepeat(NO_REPEAT);
        onStartLocalChange("");
        onEndLocalChange("");
        onChangeSelectedUserIds([]);
        onChangeSelectedGroupIds([]);
        note.reset();
        setSelfCheckIn(false);
      }
    } catch (err) {
      setStatus({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    title.trim().length > 0 && duration > 0 && startEndValid && meetingTypeValid && !submitting;

  const fieldClass =
    "w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40";
  const labelClass = "block text-sm font-medium text-foreground mb-1";

  return (
    <section className={cn(panel, panelPad)}>
      <h2 className="font-heading font-semibold text-foreground mb-4">Create Meeting</h2>
      <form onSubmit={submit} className={cn("space-y-5", formClass)}>
        {/* Essentials */}
        <div className="space-y-3">
          <div>
            <label htmlFor="meeting-title" className={labelClass}>
              Title
            </label>
            <input
              id="meeting-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className={fieldClass}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="meeting-start" className={labelClass}>
                Starts <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <DateField
                mode="datetime-local"
                value={startLocal}
                onChange={(next) => {
                  onStartLocalChange(next);
                  if (next && (!endLocal || new Date(endLocal).getTime() <= new Date(next).getTime())) {
                    const d = new Date(next);
                    d.setMinutes(d.getMinutes() + (duration > 0 ? duration : 30));
                    onEndLocalChange(toDatetimeLocal(d));
                  }
                }}
                className="w-full"
                ariaLabel="Starts"
              />
            </div>
            <div>
              <label htmlFor="meeting-end" className={labelClass}>
                Ends
              </label>
              <DateField
                mode="datetime-local"
                value={endLocal}
                min={startLocal || undefined}
                onChange={(value) => onEndLocalChange(value)}
                className="w-full"
                ariaLabel="Ends"
              />
              {!startEndValid && (
                <p className="mt-1 text-xs text-red-600">End must be after start.</p>
              )}
            </div>
          </div>
          <ParticipantPicker
            users={users}
            groups={groups}
            selectedUserIds={selectedUserIds}
            selectedGroupIds={selectedGroupIds}
            onChangeUsers={onChangeSelectedUserIds}
            onChangeGroups={onChangeSelectedGroupIds}
            usersById={usersById}
            groupsById={groupsById}
            resolvedCount={resolvedParticipantIds.length}
          />
        </div>

        {/* Secondary scheduling details — quieter, less visual weight */}
        <div className="flex flex-col gap-4 pt-1 border-t border-border">
          <div className="pt-3">
            <RepeatField
              value={repeat}
              onChange={setRepeat}
              anchorLocal={startLocal}
              labelClassName={labelClass}
              fieldClassName={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="organizer-calendar" className={labelClass}>
              Send invite from
            </label>
            {googleLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground pt-2">
                No Google calendar linked. Link one in My Availability to send Gmail invites.
              </p>
            ) : (
              <Select
                value={organizerCalendarLinkId}
                onChange={(v) => setOrganizerCalendarLinkId(v)}
                options={[
                  { value: "", label: "No invite (in-app notification only)" },
                  ...googleLinks.map((l) => ({
                    value: l.id,
                    label: l.displayName ? `${l.displayName} — ${l.externalEmail}` : l.externalEmail,
                  })),
                ]}
                buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
              />
            )}
          </div>
        </div>

        {/* Optional add-ons */}
        <div className="space-y-3 pt-1 border-t border-border">
          <p className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Optional
          </p>

          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
            <Checkbox
              checked={note.state.enabled}
              onChange={(e) => note.setEnabled(e.target.checked)}
              label="Create meeting note"
            />

            {note.state.enabled && (
              <MeetingNoteFields
                note={note}
                myProjects={myProjects}
                fieldClass={fieldClass}
                labelClass={labelClass}
              />
            )}
          </div>

          {coreSelected && (
            <div className="flex items-start gap-2 rounded-md border border-accent-teal/40 bg-accent-teal/10 p-3 text-xs text-foreground">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-accent-teal" />
              <span>The Core group is invited, so this shows on the Core calendar.</span>
            </div>
          )}

          {canSetSelfCheckIn && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <Checkbox
                checked={selfCheckIn}
                onChange={(e) => setSelfCheckIn(e.target.checked)}
                label="Self check-in (QR)"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="text-sm min-w-0">
            {status?.ok === true && !status.gcalError && (
              <span className="text-green-700">
                Meeting created. Notified {status.count} participant
                {status.count === 1 ? "" : "s"}.
                {status.notePageId && (
                  <>
                    {" "}
                    {/* Not target="_blank": the desktop shell is a single
                        webview with no window to open into, so the click did
                        nothing at all. Embedded in the web workspace this opens
                        a tab; standalone it just navigates. */}
                    <a
                      href={`/documents/${status.notePageId}`}
                      onClick={(e) => {
                        if (
                          requestOpenTabIfEmbedded(
                            `/documents/${status.notePageId}`,
                            "Meeting note",
                          )
                        )
                          e.preventDefault();
                      }}
                      className="underline font-medium"
                    >
                      View meeting note
                    </a>
                  </>
                )}
                {status.selfCheckIn && !status.notePageId && status.meetingId && (
                  <>
                    {" "}
                    <a
                      href={`/calendar/check-in/${status.meetingId}`}
                      onClick={(e) => {
                        if (
                          requestOpenTabIfEmbedded(
                            `/calendar/check-in/${status.meetingId}`,
                            "Check-in",
                          )
                        )
                          e.preventDefault();
                      }}
                      className="underline font-medium"
                    >
                      Open check-in / QR
                    </a>
                  </>
                )}
              </span>
            )}
            {status?.ok === true && status.gcalError && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <div className="font-medium">
                  Meeting created, but the Google Calendar invite didn't go out.
                </div>
                <div className="text-xs mt-0.5">
                  Notified {status.count} participant{status.count === 1 ? "" : "s"} in-app.{" "}
                  {/insufficient.*scope|insufficientPermissions|invalid_grant|unauthorized/i.test(
                    status.gcalError,
                  ) ? (
                    <>
                      Your linked Google account is missing calendar-write permission.{" "}
                      <a href="/oauth/calendar/google/start" className="underline font-medium">
                        Reconnect Google Calendar
                      </a>{" "}
                      to send invites.
                    </>
                  ) : (
                    <>Details: {status.gcalError}</>
                  )}
                </div>
              </div>
            )}
            {status?.ok === false && <span className="text-red-700">{status.error}</span>}
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className={buttonClasses("primary", "sm")}
          >
            {submitting ? "Creating…" : "Create meeting"}
          </button>
        </div>
      </form>
    </section>
  );
}

export type AddingMode = null | "user" | "group";

export function ParticipantPicker({
  users,
  groups,
  selectedUserIds,
  selectedGroupIds,
  onChangeUsers,
  onChangeGroups,
  usersById,
  groupsById,
  resolvedCount,
}: {
  users: UserOption[];
  groups: GroupOption[];
  selectedUserIds: string[];
  selectedGroupIds: string[];
  onChangeUsers: (ids: string[]) => void;
  onChangeGroups: (ids: string[]) => void;
  usersById: Map<string, UserOption>;
  groupsById: Map<string, GroupOption>;
  resolvedCount: number;
}) {
  const { fieldRadius } = useOsChrome();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const availableUsers = users.filter((u) => !selectedUserIds.includes(u.id));
  const availableGroups = groups.filter((g) => !selectedGroupIds.includes(g.id));

  const filteredUsers = availableUsers.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      (u.daliEmail ?? "").toLowerCase().includes(q)
    );
  });
  const filteredGroups = availableGroups.filter((g) =>
    query ? g.name.toLowerCase().includes(query.toLowerCase()) : true,
  );

  // Close on an outside click. The menu sits inside the wrapper, so anything
  // landing outside it is a dismissal.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const chip =
    "inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground";

  return (
    <div ref={wrapRef} className="relative">
      {/* One always-present field: chips and the caret share it, so adding a
          guest is just typing rather than first choosing "user" or "group". */}
      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) e.preventDefault();
          setOpen(true);
          wrapRef.current?.querySelector("input")?.focus();
        }}
        className={cn(
          "flex min-h-11 cursor-text flex-wrap items-center gap-1.5 border border-border bg-background p-1.5 text-sm transition-colors focus-within:border-os-accent",
          fieldRadius,
        )}
      >
        {selectedGroupIds.map((gid) => {
          const g = groupsById.get(gid);
          if (!g) return null;
          return (
            <span key={`g:${gid}`} className={cn(chip, "bg-os-accent/15 text-os-accent")}>
              <UsersRound className="h-3 w-3" />
              {g.name}
              <button
                type="button"
                onClick={() => onChangeGroups(selectedGroupIds.filter((x) => x !== gid))}
                aria-label={`Remove ${g.name}`}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {selectedUserIds.map((uid) => {
          const u = usersById.get(uid);
          if (!u) return null;
          return (
            <span key={`u:${uid}`} className={chip}>
              {userLabel(u)}
              <button
                type="button"
                onClick={() => onChangeUsers(selectedUserIds.filter((x) => x !== uid))}
                aria-label={`Remove ${userLabel(u)}`}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            selectedUserIds.length + selectedGroupIds.length === 0 ? "Add guests or a group" : ""
          }
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {resolvedCount > 0 && (
          <span className="ml-auto shrink-0 pr-1 text-[11px] text-muted-foreground">
            {resolvedCount} {resolvedCount === 1 ? "person" : "people"}
          </span>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-60 overflow-y-auto rounded-lg cal-surface p-1">
          {filteredGroups.length === 0 && filteredUsers.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>
          )}
          {filteredGroups.slice(0, 20).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                onChangeGroups([...selectedGroupIds, g.id]);
                setQuery("");
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
            >
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                <UsersRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {g.name}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {g.memberIds.length} member{g.memberIds.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          {filteredGroups.length > 0 && filteredUsers.length > 0 && (
            <div className="my-1 h-px bg-border" />
          )}
          {filteredUsers.slice(0, 40).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                onChangeUsers([...selectedUserIds, u.id]);
                setQuery("");
              }}
              className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
            >
              {userLabel(u)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScheduleWeekGrid({
  participantIds,
  showingSelfOnly = false,
  users,
  workingHours,
  workingHoursEnabled,
  durationMinutes,
  timezone,
  weekStartIso,
  weekEndIso,
  onSelectRange,
  selectedStartLocal,
  selectedEndLocal,
  compact = false,
  hideAvailability = false,
}: {
  participantIds: string[];
  // True when the caller is rendering the current user's own availability
  // (no participants picked yet) — used to relabel the header / legend.
  showingSelfOnly?: boolean;
  users: UserOption[];
  // The viewer's own working hours, used to stripe out non-working hours.
  workingHours: WhDay[];
  // False when the Working Hours feature is off — suppresses the stripes.
  workingHoursEnabled: boolean;
  durationMinutes: number;
  timezone: string;
  weekStartIso: string;
  weekEndIso: string;
  onSelectRange?: (startLocal: string, endLocal: string) => void;
  selectedStartLocal?: string;
  selectedEndLocal?: string;
  /**
   * Reduces per-hour row height substantially for use in space-constrained
   * contexts like the CreateEventModal left panel. Default false — the full
   * MeetingComposer grid is unchanged.
   */
  compact?: boolean;
  /**
   * When true, no availability tint is rendered and no fetch is issued — the
   * grid shows as a plain week skeleton. Used in CreateEventModal when there
   * are no guests (showing self-only availability is not useful). Default false
   * so MeetingComposer is unchanged.
   */
  hideAvailability?: boolean;
}) {
  const { panel } = useOsChrome();
  const [data, setData] = useState<GroupAvailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When set (via the participant list under the grid), the grid overlays just
  // this one participant's free intervals so you can read one person's
  // availability at a glance instead of the aggregate gradient.
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);
  // Bumped to force the fetch effect to re-run without changing inputs (manual
  // refresh button + tab-focus refresh).
  const [refreshKey, setRefreshKey] = useState(0);
  const revalidator = useRevalidator();
  const refresh = () => {
    setRefreshKey((k) => k + 1);
    revalidator.revalidate();
  };
  useRefreshOnFocus(refresh);

  // Stable key so the effect only re-fires on a real change. participantIds
  // itself is a fresh array each render — using it as a dep would make this
  // effect cancel+restart every render, leaving "Loading…" stuck on the screen.
  const participantKey = participantIds.slice().sort().join(",");

  useEffect(() => {
    // When hideAvailability is set there's nothing to fetch — clear any stale
    // data immediately so no tints are painted.
    if (hideAvailability) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ids = participantKey ? participantKey.split(",") : [];
    if (ids.length === 0) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // durationMinutes is intentionally omitted: it only affects the server's
    // ≥-duration match windows (data.days), which this grid never reads — the
    // gradient and slot breakdown are built from per-user free intervals. Re-
    // fetching on every drag would just flash "Loading availability…".
    fetch("/api/calendar/group-availability", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userIds: ids,
        weekStartIso,
        weekEndIso,
        durationMinutes,
        timezone,
      }),
    })
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(json.error ?? "Failed to load availability");
          setData(null);
        } else {
          setData(json as GroupAvailResponse);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantKey, weekStartIso, weekEndIso, timezone, refreshKey, hideAvailability]);

  // Build the 7-day axis from the week window so empty days still render.
  const weekStart = new Date(weekStartIso);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const dayDate = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    return {
      dayOfWeek: dayDate.getUTCDay(),
      num: dayDate.getUTCDate(),
      dateUtc: dayDate,
    };
  });

  // When2Meet-style availability gradient: each 15-min cell is tinted by the
  // fraction of participants free at that time. We render the gradient as the
  // background layer, leaving the Busy blocks out entirely — free vs. busy is
  // already encoded in the cell's saturation.
  const eventsByDay: Record<number, EventBlock[]> = {};
  const totalParticipants = participantIds.length;
  const CELL_HOURS = SNAP_HOURS; // 10-minute availability cells
  const GRID_START_H = HOURS[0];
  const GRID_END_H = HOURS[HOURS.length - 1] + 1;
  const CELLS_PER_DAY = Math.round((GRID_END_H - GRID_START_H) / CELL_HOURS);

  // Compact mode renders the full-size grid (legible text) inside a scroll
  // container rather than scaling it down; focus the initial scroll around the
  // user's working-hours start (fallback ~7am) so day hours are in view without
  // dropping the ability to scroll to early-morning / late-night slots.
  const compactScrollRef = useRef<HTMLDivElement | null>(null);
  const focusHour = (() => {
    const starts = (workingHours ?? [])
      .flatMap((d) => (d.segments ?? []).map((s) => s.startMinute / 60))
      .filter((h) => Number.isFinite(h));
    const earliest = starts.length ? Math.min(...starts) : 8;
    return Math.max(GRID_START_H, earliest - 1);
  })();
  useEffect(() => {
    if (compact && compactScrollRef.current) {
      compactScrollRef.current.scrollTop = Math.max(0, (focusHour - GRID_START_H) * HOUR_PX);
    }
  }, [compact, weekStartIso, focusHour, GRID_START_H]);

  // Pre-parse each participant's free intervals into sorted (startMs, endMs)
  // tuples for fast containment checks below.
  const perUserFree: { startMs: number; endMs: number }[][] = data
    ? data.perUser.map((u) =>
        u.free
          .map((iv) => ({
            startMs: new Date(iv.startIso).getTime(),
            endMs: new Date(iv.endIso).getTime(),
          }))
          .sort((a, b) => a.startMs - b.startMs),
      )
    : [];

  function freeCountAtCell(cellStartMs: number, cellEndMs: number): number {
    let n = 0;
    for (const intervals of perUserFree) {
      let covered = false;
      for (const iv of intervals) {
        if (iv.endMs <= cellStartMs) continue;
        if (iv.startMs > cellStartMs) break;
        if (iv.startMs <= cellStartMs && iv.endMs >= cellEndMs) {
          covered = true;
        }
        break;
      }
      if (covered) n += 1;
    }
    return n;
  }

  // Build per-day cell tints. Each entry is { startHour, durationHours, alpha }
  // ready to render as a colored absolute-positioned block.
  type CellTint = { startHour: number; alpha: number };
  const tintsByColIdx: CellTint[][] = data
    ? days.map((d, colIdx) => {
        const cells: CellTint[] = [];
        const dayStartMs = weekStart.getTime() + colIdx * 86_400_000;
        for (let i = 0; i < CELLS_PER_DAY; i++) {
          const hour = GRID_START_H + i * CELL_HOURS;
          const cellStartMs = dayStartMs + hour * 3_600_000;
          const cellEndMs = cellStartMs + CELL_HOURS * 3_600_000;
          const k = freeCountAtCell(cellStartMs, cellEndMs);
          if (k === 0) continue;
          const alpha = totalParticipants > 0 ? k / totalParticipants : 0;
          cells.push({ startHour: hour, alpha });
        }
        // Reference d so the linter doesn't complain (we may use it later).
        void d;
        return cells;
      })
    : [];

  // Per-day free blocks for the single hovered participant. When set, the grid
  // paints these (solid green) instead of the aggregate gradient so the user
  // can read one person's availability at a glance. Each interval is clamped to
  // the visible [GRID_START_H, GRID_END_H) window of its day column.
  const hoveredFreeByColIdx: { startHour: number; durationHours: number }[][] =
    data && hoveredUserId
      ? (() => {
          const free = data.perUser.find((u) => u.userId === hoveredUserId)?.free ?? [];
          const ivs = free
            .map((iv) => ({
              startMs: new Date(iv.startIso).getTime(),
              endMs: new Date(iv.endIso).getTime(),
            }))
            .sort((a, b) => a.startMs - b.startMs);
          return days.map((_, colIdx) => {
            const dayStartMs = weekStart.getTime() + colIdx * 86_400_000;
            const winStartMs = dayStartMs + GRID_START_H * 3_600_000;
            const winEndMs = dayStartMs + GRID_END_H * 3_600_000;
            const blocks: { startHour: number; durationHours: number }[] = [];
            for (const iv of ivs) {
              const s = Math.max(iv.startMs, winStartMs);
              const e = Math.min(iv.endMs, winEndMs);
              if (e <= s) continue;
              blocks.push({
                startHour: (s - dayStartMs) / 3_600_000,
                durationHours: (e - s) / 3_600_000,
              });
            }
            return blocks;
          });
        })()
      : [];

  // Compute the selected-slot overlay (rendered separately so we can show a
  // hover popover with attending vs. unavailable participants).
  type SelectedSlot = {
    dow: number;
    startHour: number;
    duration: number;
    available: UserOption[];
    unavailable: UserOption[];
  };
  let selectedSlot: SelectedSlot | null = null;
  if (selectedStartLocal && selectedEndLocal && data && participantIds.length > 0) {
    const sd = new Date(selectedStartLocal);
    const ed = new Date(selectedEndLocal);
    if (!isNaN(sd.getTime()) && !isNaN(ed.getTime()) && ed.getTime() > sd.getTime()) {
      const sameDay = sd.toDateString() === ed.toDateString();
      const dow = sd.getDay();
      const startHour = sd.getHours() + sd.getMinutes() / 60;
      const endHour = ed.getHours() + ed.getMinutes() / 60;
      const duration = sameDay ? endHour - startHour : 24 - startHour;
      if (duration > 0) {
        // A user is "available" if their free intervals cover the entire
        // [sd, ed] window. We allow the union of multiple free intervals.
        const slotStartMs = sd.getTime();
        const slotEndMs = ed.getTime();
        const usersById = new Map(users.map((u) => [u.id, u]));
        const perUserById = new Map(data.perUser.map((p) => [p.userId, p]));
        const available: UserOption[] = [];
        const unavailable: UserOption[] = [];
        for (const uid of participantIds) {
          const user = usersById.get(uid) ?? {
            id: uid,
            firstName: uid,
            lastName: "",
            daliEmail: null,
          };
          const free = perUserById.get(uid)?.free ?? [];
          // Build the contiguous free-coverage over [slotStartMs, slotEndMs].
          // Sort & merge first, then walk.
          const sortedFree = free
            .map((iv) => ({ s: new Date(iv.startIso).getTime(), e: new Date(iv.endIso).getTime() }))
            .sort((a, b) => a.s - b.s);
          let cursor = slotStartMs;
          for (const iv of sortedFree) {
            if (iv.e <= cursor) continue;
            if (iv.s > cursor) break;
            cursor = Math.max(cursor, iv.e);
            if (cursor >= slotEndMs) break;
          }
          if (cursor >= slotEndMs) available.push(user);
          else unavailable.push(user);
        }
        selectedSlot = { dow, startHour, duration, available, unavailable };
      }
    }
  }

  const weekGrid = (
    <WeekGrid
      days={days}
      eventsByDay={eventsByDay}
      showSubHourGrid
      timezone={timezone}
      backgroundLayer={(dayIdx) => (
        <>
          {!hideAvailability && (
            hoveredUserId ? (
              // One participant's own free intervals (solid green), so the
              // user can read that person's availability at a glance.
              (hoveredFreeByColIdx[dayIdx] ?? []).map((b, i) => (
                <BlockBlock
                  key={`hover-${i}`}
                  topHour={GRID_START_H}
                  startHour={b.startHour}
                  duration={b.durationHours}
                  style={{ backgroundColor: availabilityTint(1) }}
                />
              ))
            ) : (
              /* Aggregate gradient. Drawn first so the stripes layer on top. */
              (tintsByColIdx[dayIdx] ?? []).map((t, i) => (
                <BlockBlock
                  key={`tint-${i}`}
                  topHour={GRID_START_H}
                  startHour={t.startHour}
                  duration={CELL_HOURS}
                  style={{ backgroundColor: availabilityTint(t.alpha) }}
                />
              ))
            )
          )}
          {workingHoursStripeLayer(workingHours, days[dayIdx].dayOfWeek, {
            enabled: workingHoursEnabled,
          })}
        </>
      )}
      overlayLayer={(dayIdx) => {
        if (!selectedSlot) return null;
        if (days[dayIdx]?.dayOfWeek !== selectedSlot.dow) return null;
        return (
          <SelectedSlotBlock
            startHour={selectedSlot.startHour}
            duration={selectedSlot.duration}
            available={selectedSlot.available}
            unavailable={selectedSlot.unavailable}
          />
        );
      }}
      onDayPointerSelect={
        onSelectRange
          ? (dayIdx, startHour, endHour) => {
              const day = days[dayIdx];
              if (!day) return;
              onSelectRange(
                dayHourToLocal(day.dateUtc, startHour),
                dayHourToLocal(day.dateUtc, endHour),
              );
            }
          : undefined
      }
    />
  );

  return (
    <section className={cn(panel, "p-4 flex flex-col", compact && "min-h-0")}>
      <WeekToolbar
        monthLabel={"Schedule preview"}
        weekStartIso={weekStartIso}
        onRefresh={refresh}
        refreshing={loading || revalidator.state !== "idle"}
        legend={
          hideAvailability
            ? undefined
            : showingSelfOnly
              ? [{ swatch: availabilityTint(1), label: "Free" }]
              : [
                  { swatch: availabilityTint(0.33), label: "Few free" },
                  { swatch: availabilityTint(0.66), label: "Some free" },
                  { swatch: availabilityTint(1), label: "All free" },
                ]
        }
      />
      {participantIds.length === 0 ? null : (
        <>
          {!hideAvailability && loading && (
            <div className="px-4 py-1 text-xs text-muted-foreground">Loading availability…</div>
          )}
          {!hideAvailability && error && (
            <div className="px-4 py-2 text-xs text-red-700">{error}</div>
          )}
          {compact ? (
            // Full-size grid in a scroll container (legible text), pre-scrolled
            // to the user's day hours; scroll for early-morning / late slots.
            <div
              ref={compactScrollRef}
              className="w-full min-h-0 flex-1 overflow-y-auto"
              style={{ maxHeight: "26rem" }}
            >
              {weekGrid}
            </div>
          ) : (
            weekGrid
          )}
          {!hideAvailability && !showingSelfOnly && data && participantIds.length > 0 && (
            <ParticipantAvailabilityList
              participantIds={participantIds}
              users={users}
              availableIds={
                selectedSlot ? new Set(selectedSlot.available.map((u) => u.id)) : null
              }
              hoveredUserId={hoveredUserId}
              onHover={setHoveredUserId}
            />
          )}
        </>
      )}
    </section>
  );
}

// Per-person availability for the picked slot, listed under the grid. The wide
// panel has room to state the whole answer, so this replaces both the invitee
// roster that used to sit above the grid and the hover popover on the selected
// block. Once a slot is picked the names split into Available / Busy groups;
// before that it's one flat roster. Hovering a name overlays just that one
// person's free intervals on the grid.
export function ParticipantAvailabilityList({
  participantIds,
  users,
  availableIds,
  hoveredUserId,
  onHover,
}: {
  participantIds: string[];
  users: UserOption[];
  /** Ids free for the whole selected slot, or null when no slot is picked. */
  availableIds: Set<string> | null;
  hoveredUserId: string | null;
  onHover: (userId: string | null) => void;
}) {
  const usersById = new Map(users.map((u) => [u.id, u]));
  const entries = participantIds.map(
    (uid) =>
      usersById.get(uid) ?? { id: uid, firstName: uid, lastName: "", daliEmail: null },
  );
  const available = availableIds ? entries.filter((u) => availableIds.has(u.id)) : [];
  const busy = availableIds ? entries.filter((u) => !availableIds.has(u.id)) : [];

  const chip = (user: UserOption, free: boolean | null) => {
    const active = hoveredUserId === user.id;
    return (
      <button
        key={user.id}
        type="button"
        onMouseEnter={() => onHover(user.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(user.id)}
        onBlur={() => onHover(null)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
          active
            ? "bg-accent-green text-[hsl(203_38%_18%)]"
            : "bg-muted text-muted-foreground hover:bg-muted/70",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            free === null
              ? "bg-muted-foreground/40"
              : free
                ? "bg-green-600 dark:bg-green-400"
                : "bg-red-600 dark:bg-red-400",
          )}
        />
        {userLabel(user)}
      </button>
    );
  };

  const group = (label: string, members: UserOption[], free: boolean) =>
    members.length === 0 ? null : (
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label} · {members.length}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {members.map((u) => chip(u, free))}
        </div>
      </div>
    );

  return (
    <div className="mt-3 border-t border-border px-2 pt-3">
      {availableIds ? (
        <div className="flex flex-col gap-2.5">
          {group("Available", available, true)}
          {group("Busy", busy, false)}
        </div>
      ) : (
        <>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Pick a time to see who&apos;s free
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {entries.map((u) => chip(u, null))}
          </div>
        </>
      )}
    </div>
  );
}

export function SelectedSlotBlock({
  startHour,
  duration,
  available,
  unavailable,
}: {
  startHour: number;
  duration: number;
  available: UserOption[];
  unavailable: UserOption[];
}) {
  const total = available.length + unavailable.length;
  const top = (startHour - HOURS[0]) * HOUR_PX;
  const height = duration * HOUR_PX;
  return (
    <div
      className="absolute left-0 right-0 z-30 border-2 border-os-accent bg-os-accent/10 rounded-sm"
      style={{ top, height }}
    >
      <div className="m-1 inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold rounded-sm shadow-sm bg-os-accent text-os-bg">
        {available.length}/{total}
      </div>
    </div>
  );
}
