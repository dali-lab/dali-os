import { useEffect, useMemo, useState } from "react";
import { Select } from "~/components/ui/floating";
import { Radio } from "~/components/ui/Radio";
import { FolderPicker, type Destination } from "~/components/drive/FolderPicker";
import { useDriveDestinations } from "~/components/drive/use-drive-destinations";
import {
  noteDestinationRows,
  noteInitialDest,
  noteLocationFromDest,
  type MeetingNoteLocation,
  type MeetingNoteState,
  CORE_NOTE_FOLDER_LABEL,
  CORE_NOTE_LABEL,
  emptyMeetingNote,
} from "~/calendar/components/meeting-note";

// Shared "meeting note" fields for the two create surfaces (CreateScheduledMeetingForm
// and CreateEventModal). The pure state model + payload derivation live in
// ./meeting-note; this file adds the React hook + UI and re-exports them so the
// parents have a single import site.

export {
  type MeetingNoteLocation,
  type MeetingNoteState,
  CORE_NOTE_FOLDER_LABEL,
  CORE_NOTE_LABEL,
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
    setWhiteboard: (whiteboard: boolean) => patch({ whiteboard }),
    setAbout: (about: string) => patch({ about }),
    setSubtype: (subtype: MeetingNoteState["subtype"]) => patch({ subtype }),
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

export function MeetingNoteFields({
  note,
  myProjects = [],
  fieldClass,
  labelClass,
  core = false,
}: {
  note: MeetingNoteController;
  myProjects?: { id: string; name: string }[];
  fieldClass: string;
  labelClass: string;
  /** The meeting is a Core meeting. Relabels the "no project" option to
   *  "Core" and files a project-less note in Core's folder; the About picker
   *  still offers the organizer's projects (a project note files in the
   *  project, not Core). */
  core?: boolean;
}) {
  const { state } = note;

  // A project-less Core note files in Core's folder and needs a name, so seed
  // an empty one — a name they typed themselves survives.
  useEffect(() => {
    if (!core) return;
    if (state.about === "" && state.label.trim() === "") note.setLabel(CORE_NOTE_LABEL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const destinations = useDriveDestinations({ enabled: pickerOpen, onError: () => setPickerOpen(false) });
  const noteRows = useMemo(() => noteDestinationRows(destinations.rows), [destinations.rows]);

  function onPick(dest: Destination) {
    const location = noteLocationFromDest(dest, noteRows);
    if (!location) return;
    note.setLocation(location);
    setPickerOpen(false);
  }

  const isProject = state.about !== "";
  const locationLabel = state.location?.label ?? "Lab-wide";

  return (
    <div className="pl-6 space-y-3">
      <div>
        <span className={labelClass}>About</span>
        <Select
          value={state.about}
          onChange={(v) => note.setAbout(v)}
          options={[
            // For a Core meeting the "no project" answer is Core itself.
            { value: "", label: core ? "Core" : "General (no project)" },
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
            <Radio
              name="meeting-subtype"
              checked={state.subtype === "Other"}
              onChange={() => note.setSubtype("Other")}
              label="Other"
            />
          </div>
          {state.subtype === "Other" && (
            <input
              aria-label="Meeting type name"
              type="text"
              value={state.label}
              onChange={(e) => note.setLabel(e.target.value)}
              placeholder="e.g. Design review"
              maxLength={80}
              required
              className={`${fieldClass} mt-2`}
            />
          )}
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
            {core ? (
              // Core files its notes the way a project does — always its own
              // meeting-notes folder — so there's no destination to choose.
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                {CORE_NOTE_FOLDER_LABEL}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                  {locationLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/40"
                >
                  Change…
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {pickerOpen && destinations.status === "ready" && (
        <FolderPicker
          open
          heading="Save meeting note to"
          drives={noteRows.drives}
          folders={noteRows.folders}
          preferFolderType="Meetings"
          initial={noteInitialDest(state.location, noteRows)}
          confirmLabel="Save here"
          onClose={() => setPickerOpen(false)}
          onConfirm={onPick}
        />
      )}
    </div>
  );
}
