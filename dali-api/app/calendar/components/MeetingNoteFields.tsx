import { useState } from "react";
import { Select } from "~/components/ui/floating";
import { Radio } from "~/components/ui/Radio";
import {
  DestinationPicker,
  type PickerDrive,
  type PickerFolder,
  type Destination,
} from "~/components/drive/DestinationPicker";
import {
  type MeetingNoteLocation,
  type MeetingNoteState,
  emptyMeetingNote,
} from "~/calendar/components/meeting-note";

// Shared "meeting note" fields for the two create surfaces (CreateScheduledMeetingForm
// and CreateEventModal). The pure state model + payload derivation live in
// ./meeting-note; this file adds the React hook + UI and re-exports them so the
// parents have a single import site.

export {
  type MeetingNoteLocation,
  type MeetingNoteState,
  emptyMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
} from "~/calendar/components/meeting-note";

export type MeetingNoteController = ReturnType<typeof useMeetingNote>;

export function useMeetingNote() {
  const [state, setState] = useState<MeetingNoteState>(emptyMeetingNote);
  const patch = (p: Partial<MeetingNoteState>) => setState((s) => ({ ...s, ...p }));
  return {
    state,
    setEnabled: (enabled: boolean) => patch({ enabled }),
    setAbout: (about: string) => patch({ about }),
    setSubtype: (subtype: "Team" | "Partner") => patch({ subtype }),
    setLabel: (label: string) => patch({ label }),
    setLocation: (location: MeetingNoteLocation | null) => patch({ location }),
    // Prefill "About" from a single invited project group — a default, not a lock:
    // only fills when the organizer hasn't already chosen an About, and never
    // touches the enabled toggle (notes stay opt-in).
    applyGroupPrefill: (projectId: string | null) =>
      setState((s) => (projectId && s.about === "" ? { ...s, about: projectId } : s)),
    reset: () => setState(emptyMeetingNote),
  };
}

type MoveDestination = {
  type: "Lab" | "Project";
  id: string | null;
  label: string;
  iconEmoji: string | null;
  folders: { id: string; title: string; parentId: string | null }[];
};

export function MeetingNoteFields({
  note,
  myProjects,
  fieldClass,
  labelClass,
}: {
  note: MeetingNoteController;
  myProjects: { id: string; name: string }[];
  fieldClass: string;
  labelClass: string;
}) {
  const { state } = note;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drives, setDrives] = useState<PickerDrive[]>([]);
  const [folders, setFolders] = useState<PickerFolder[]>([]);
  const [loadedDest, setLoadedDest] = useState(false);

  // Lazily fetch Drive destinations the first time the picker is opened — mirrors
  // MoveToDialog's transform of /api/move-destinations.
  async function openPicker() {
    if (!loadedDest) {
      try {
        const res = await fetch("/api/move-destinations", { credentials: "include" });
        const json = await res.json();
        const dests = (json.destinations ?? []) as MoveDestination[];
        setDrives(dests.map((d) => ({ id: d.type === "Lab" ? "lab" : d.id!, label: d.label, iconEmoji: d.iconEmoji })));
        setFolders(
          dests.flatMap((d) => {
            const driveId = d.type === "Lab" ? "lab" : d.id!;
            return d.folders.map((f) => ({ id: f.id, driveId, parentId: f.parentId, title: f.title }));
          }),
        );
        setLoadedDest(true);
      } catch {
        // Leave the picker unopened on failure; the default (Lab-wide) still applies.
        return;
      }
    }
    setPickerOpen(true);
  }

  function onPick(dest: Destination) {
    const drive = drives.find((d) => d.id === dest.driveId);
    const folder = dest.folderId ? folders.find((f) => f.id === dest.folderId) : null;
    const label = folder ? `${drive?.label ?? "Drive"} / ${folder.title}` : (drive?.label ?? "Lab-wide");
    note.setLocation({
      workspaceType: dest.driveId === "lab" ? "Lab" : "Project",
      workspaceId: dest.driveId === "lab" ? null : dest.driveId,
      parentPageId: dest.folderId,
      label,
    });
    setPickerOpen(false);
  }

  const isProject = state.about !== "";
  const locationLabel = state.location?.label ?? "Lab-wide";

  return (
    <div className="pl-6 space-y-3">
      <div>
        <label htmlFor="meeting-about" className={labelClass}>
          About
        </label>
        <Select
          value={state.about}
          onChange={(v) => note.setAbout(v)}
          options={[
            { value: "", label: "General (no project)" },
            ...myProjects.map((p) => ({ value: p.id, label: p.name })),
          ]}
          buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
        />
      </div>

      {isProject ? (
        <div>
          <span className={labelClass}>Type</span>
          <div className="flex items-center gap-5 pt-1">
            <Radio
              name="meeting-subtype"
              checked={state.subtype === "Team"}
              onChange={() => note.setSubtype("Team")}
              label="Team meeting"
            />
            <Radio
              name="meeting-subtype"
              checked={state.subtype === "Partner"}
              onChange={() => note.setSubtype("Partner")}
              label="Partner meeting"
            />
          </div>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="meeting-name" className={labelClass}>
              Name
            </label>
            <input
              id="meeting-name"
              type="text"
              value={state.label}
              onChange={(e) => note.setLabel(e.target.value)}
              placeholder="e.g. All-hands sync"
              required
              className={fieldClass}
            />
          </div>
          <div>
            <span className={labelClass}>Save note to</span>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                {locationLabel}
              </span>
              <button
                type="button"
                onClick={() => void openPicker()}
                className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/40"
              >
                Change…
              </button>
            </div>
          </div>
        </>
      )}

      {pickerOpen && (
        <DestinationPicker
          open
          heading="Save meeting note to"
          drives={drives}
          folders={folders}
          initial={
            state.location
              ? {
                  driveId: state.location.workspaceType === "Lab" ? "lab" : (state.location.workspaceId ?? "lab"),
                  folderId: state.location.parentPageId,
                }
              : { driveId: "lab", folderId: null }
          }
          confirmLabel="Save here"
          onClose={() => setPickerOpen(false)}
          onConfirm={onPick}
        />
      )}
    </div>
  );
}
