import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRevalidator } from "react-router";
import { AlignLeft, Clock, DoorOpen, MapPin, UsersRound } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { DateField } from "~/components/ui/DateField";
import { TimeField } from "~/components/ui/TimeField";
import { ParticipantPicker } from "~/calendar/components/scheduling";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { RoomPicker } from "~/rooms/components/RoomPicker";

// Shape of GET /api/scheduled-meetings/:id/edit-context.
export type EditContext = {
  // Per-guest RSVP (userId → response), from the meeting's invite notifications.
  responsesByUserId?: Record<string, "Accepted" | "Declined" | "Tentative">;
  meeting: {
    id: string;
    title: string;
    startTime: string | null;
    durationMinutes: number;
    recurrenceRule: string | null;
    location: string | null;
    roomIds: string[];
    description: string | null;
    scopeType: "None" | "Group" | "UserList" | "Project";
    groupId: string | null;
    participantUserIds: string[];
    guestEmails: string[];
    googleSynced: boolean;
    organizerId: string;
    upcoming: boolean;
  };
  options: {
    users: { id: string; firstName: string; lastName: string; daliEmail: string | null }[];
    groups: {
      id: string;
      name: string;
      memberIds: string[];
      projectId: string | null;
      systemKey: string | null;
    }[];
  };
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// An ISO instant → the browser-local "YYYY-MM-DD" / "HH:mm" the date/time fields
// speak (create-side uses the same browser-local convention).
function isoToLocal(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const fieldClass =
  "w-full px-3.5 py-2.5 text-sm border border-border rounded-[10px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40";
const labelClass =
  "block text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] mb-2";

// A form line with a leading glyph in the gutter, mirroring CreateEventModal's
// guest row so the edit and create surfaces read the same.
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

/**
 * Edit a meeting's title, time, location, description, and guest list from the
 * Attendance tab. Fetches its context (current values + member/group directory)
 * on open, then posts to
 * /api/scheduled-meetings/:id/update. Recurrence is carried through unchanged —
 * a repeating meeting keeps its cadence; changing the cadence is a follow-up.
 */
export function EditMeetingModal({
  meetingId,
  onClose,
}: {
  meetingId: string;
  onClose: () => void;
}) {
  const revalidator = useRevalidator();
  const [ctx, setCtx] = useState<EditContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const roomBooking = useFeatureFlag("room-booking");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [guestEmails, setGuestEmails] = useState<string[]>([]);
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the edit context once when the modal opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scheduled-meetings/${meetingId}/edit-context`, {
          credentials: "include",
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(json.error ?? "Couldn't load this meeting.");
          return;
        }
        const data = json as EditContext;
        const { date: d, time: t } = isoToLocal(data.meeting.startTime);
        const end = data.meeting.startTime
          ? isoToLocal(
              new Date(
                new Date(data.meeting.startTime).getTime() +
                  data.meeting.durationMinutes * 60_000,
              ).toISOString(),
            ).time
          : "";
        setTitle(data.meeting.title);
        setDate(d);
        setStartTime(t);
        setEndTime(end);
        setRecurrenceRule(data.meeting.recurrenceRule);
        setLocation(data.meeting.location ?? "");
        setRoomIds(data.meeting.roomIds ?? []);
        setDescription(data.meeting.description ?? "");
        setGuestEmails(data.meeting.guestEmails);
        if (data.meeting.scopeType === "Group" && data.meeting.groupId) {
          // Anyone on the meeting who isn't in the group was invited on top of
          // it; select them too so saving doesn't drop them.
          const members = new Set(
            data.options.groups.find((g) => g.id === data.meeting.groupId)?.memberIds ?? [],
          );
          setSelectedGroupIds([data.meeting.groupId]);
          setSelectedUserIds(data.meeting.participantUserIds.filter((id) => !members.has(id)));
        } else {
          setSelectedUserIds(data.meeting.participantUserIds);
          setSelectedGroupIds([]);
        }
        setCtx(data);
      } catch {
        if (!cancelled) setLoadError("Couldn't load this meeting.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const usersById = useMemo(
    () => new Map((ctx?.options.users ?? []).map((u) => [u.id, u])),
    [ctx],
  );
  const groupsById = useMemo(
    () => new Map((ctx?.options.groups ?? []).map((g) => [g.id, g])),
    [ctx],
  );
  const guestResponses = useMemo(
    () => new Map(Object.entries(ctx?.responsesByUserId ?? {})),
    [ctx],
  );

  const resolvedParticipantIds = useMemo(() => {
    const set = new Set<string>(selectedUserIds);
    for (const gid of selectedGroupIds) {
      const g = groupsById.get(gid);
      if (g) for (const uid of g.memberIds) set.add(uid);
    }
    return Array.from(set);
  }, [selectedUserIds, selectedGroupIds, groupsById]);

  const startMin = timeToMinutes(startTime);
  let endMin = timeToMinutes(endTime);
  if (startTime && endTime && endMin <= startMin) endMin += 24 * 60; // next-day rollover
  const durationMinutes = startTime && endTime ? endMin - startMin : 0;
  const timeValid = !startTime || !endTime || durationMinutes > 0;

  const canSave =
    !!ctx &&
    title.trim() !== "" &&
    date !== "" &&
    startTime !== "" &&
    endTime !== "" &&
    durationMinutes > 0 &&
    !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Always sent, blank included: clearing a field has to clear it here and
      // on the linked Google event, which an omitted key would leave untouched.
      const payload: Record<string, unknown> = {
        title: title.trim(),
        durationMinutes,
        location: location.trim(),
        description: description.trim(),
        guestEmails,
      };
      if (roomBooking) payload.roomIds = roomIds;
      const local = new Date(`${date}T${startTime}`);
      if (!isNaN(local.getTime())) payload.startTime = local.toISOString();
      if (recurrenceRule) payload.recurrenceRule = recurrenceRule;
      if (selectedGroupIds.length === 1) {
        payload.scopeType = "Group";
        payload.groupId = selectedGroupIds[0];
        if (selectedUserIds.length > 0) payload.extraUserIds = selectedUserIds;
      } else if (resolvedParticipantIds.length > 0) {
        payload.scopeType = "UserList";
        payload.participantUserIds = resolvedParticipantIds;
      } else {
        payload.scopeType = "None";
      }

      const res = await fetch(`/api/scheduled-meetings/${meetingId}/update`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setSaveError(json.error ?? "Couldn't save changes.");
        setSaving(false);
        return;
      }
      revalidator.revalidate();
      onClose();
    } catch {
      setSaveError("Couldn't save changes.");
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  // Portaled to <body>: this can open from inside the calendar's event popover,
  // whose positioned ancestors would otherwise trap the fixed overlay.
  return createPortal(
    <Modal
      open
      onClose={onClose}
      labelledBy="edit-meeting-title"
      containerClassName={modalCardClass("max-w-lg")}
      disableEscape={saving}
    >
      <ModalHeader titleId="edit-meeting-title" title="Edit event" onClose={onClose} />

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : !ctx ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <label htmlFor="edit-mtg-title" className={labelClass}>
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="edit-mtg-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={fieldClass}
              placeholder="e.g. Deserto sync"
            />
          </div>

          {/* Guests */}
          <FieldRow icon={UsersRound}>
            <ParticipantPicker
              users={ctx.options.users}
              groups={ctx.options.groups}
              selectedUserIds={selectedUserIds}
              selectedGroupIds={selectedGroupIds}
              onChangeUsers={setSelectedUserIds}
              onChangeGroups={setSelectedGroupIds}
              usersById={usersById}
              groupsById={groupsById}
              resolvedCount={resolvedParticipantIds.length}
              responsesByUserId={guestResponses}
              guestEmails={guestEmails}
              onChangeGuestEmails={ctx.meeting.googleSynced ? setGuestEmails : undefined}
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
                onChange={(v) => setDate(v)}
                ariaLabel="Date"
                className="min-w-[130px]"
              />
              <TimeField
                value={startTime}
                onChange={(v) => setStartTime(v)}
                ariaLabel="Start time"
                className="w-[110px]"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <TimeField
                value={endTime}
                onChange={(v) => setEndTime(v)}
                ariaLabel="End time"
                className="w-[110px]"
              />
            </div>
            {!timeValid && (
              <p className="mt-1 text-xs text-red-600">End must be after start.</p>
            )}
            {recurrenceRule && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                This event repeats — changes apply to the whole series.
              </p>
            )}
          </div>

          {/* Location */}
          <div>
            <label htmlFor="edit-mtg-location" className={labelClass}>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Location
              </span>
            </label>
            <input
              id="edit-mtg-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={fieldClass}
              placeholder="Video call, room, or address"
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
            <label htmlFor="edit-mtg-description" className={labelClass}>
              <span className="inline-flex items-center gap-1">
                <AlignLeft className="h-3 w-3" /> Description
              </span>
            </label>
            <textarea
              id="edit-mtg-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`${fieldClass} resize-y`}
              placeholder="Add description"
            />
          </div>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        </div>
      )}

      {ctx && !loadError && (
        <ModalFooter onCancel={onClose} cancelLabel="Cancel">
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="os-btn-primary disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </ModalFooter>
      )}
    </Modal>,
    document.body,
  );
}
