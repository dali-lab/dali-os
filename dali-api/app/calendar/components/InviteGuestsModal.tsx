import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRevalidator } from "react-router";
import { UserPlus, UsersRound } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { useToast } from "~/components/ui/toast";
import { ParticipantPicker } from "~/calendar/components/scheduling";
import type { EditContext } from "~/calendar/components/EditMeetingModal";

/**
 * Add people or groups to an existing meeting — also after it has happened, to
 * put someone who wasn't invited on its attendance roster. Additive only; the
 * current guest list is shown as a count and can't be changed here (that's Edit).
 * Posts to /api/scheduled-meetings/:id/invite.
 */
export function InviteGuestsModal({
  meetingId,
  onClose,
}: {
  meetingId: string;
  onClose: () => void;
}) {
  const revalidator = useRevalidator();
  const toast = useToast();
  const [ctx, setCtx] = useState<EditContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
        setCtx(json as EditContext);
      } catch {
        if (!cancelled) setLoadError("Couldn't load this meeting.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const invitedIds = useMemo(
    () => new Set(ctx ? [...ctx.meeting.participantUserIds, ctx.meeting.organizerId] : []),
    [ctx],
  );
  const usersById = useMemo(
    () => new Map((ctx?.options.users ?? []).map((u) => [u.id, u])),
    [ctx],
  );
  const groupsById = useMemo(
    () => new Map((ctx?.options.groups ?? []).map((g) => [g.id, g])),
    [ctx],
  );
  // People already on the meeting can't be picked again.
  const pickableUsers = useMemo(
    () => (ctx?.options.users ?? []).filter((u) => !invitedIds.has(u.id)),
    [ctx, invitedIds],
  );

  const newIds = useMemo(() => {
    const set = new Set<string>(selectedUserIds);
    for (const gid of selectedGroupIds) {
      for (const uid of groupsById.get(gid)?.memberIds ?? []) set.add(uid);
    }
    for (const id of invitedIds) set.delete(id);
    return set;
  }, [selectedUserIds, selectedGroupIds, groupsById, invitedIds]);

  const canSave = !!ctx && newIds.size > 0 && !saving;

  async function save() {
    if (!canSave || !ctx) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/scheduled-meetings/${meetingId}/invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: selectedUserIds, groupIds: selectedGroupIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSaveError(json.error ?? "Couldn't invite them.");
        setSaving(false);
        return;
      }
      const n = json.addedCount as number;
      toast.success(`Added ${n} ${n === 1 ? "person" : "people"} to ${ctx.meeting.title}`);
      if (json.gcalError) {
        toast.error("They're on the meeting in DALI, but the Google Calendar event wasn't updated.");
      }
      revalidator.revalidate();
      onClose();
    } catch {
      setSaveError("Couldn't invite them.");
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  // Portaled: this opens from inside the calendar's event popover, whose
  // positioned ancestors would otherwise trap the fixed overlay.
  return createPortal(
    <Modal
      open
      onClose={onClose}
      labelledBy="invite-guests-title"
      containerClassName={modalCardClass("max-w-lg")}
      disableEscape={saving}
    >
      <ModalHeader titleId="invite-guests-title" title="Invite people" onClose={onClose} />

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : !ctx ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{ctx.meeting.title}</span> ·{" "}
            {invitedIds.size} already invited
          </p>
          <div className="flex gap-4">
            <UsersRound className="mt-2.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <ParticipantPicker
                users={pickableUsers}
                groups={ctx.options.groups}
                selectedUserIds={selectedUserIds}
                selectedGroupIds={selectedGroupIds}
                onChangeUsers={setSelectedUserIds}
                onChangeGroups={setSelectedGroupIds}
                usersById={usersById}
                groupsById={groupsById}
                resolvedCount={newIds.size}
              />
            </div>
          </div>
          {!ctx.meeting.upcoming && (
            <p className="text-xs text-muted-foreground">
              This event has already happened. New guests are added to its attendance roster
              without being sent an invite.
            </p>
          )}
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        </div>
      )}

      {ctx && !loadError && (
        <ModalFooter onCancel={onClose} cancelLabel="Cancel">
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="os-btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" />
            {saving
              ? "Inviting…"
              : newIds.size > 0
                ? `Invite ${newIds.size} ${newIds.size === 1 ? "person" : "people"}`
                : "Invite"}
          </button>
        </ModalFooter>
      )}
    </Modal>,
    document.body,
  );
}
