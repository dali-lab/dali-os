import { useEffect, useMemo, useState } from "react";
import { Select } from "~/components/ui/floating";
import { Radio } from "~/components/ui/Radio";
import { FolderPicker, type Destination } from "~/components/drive/FolderPicker";
import { useDriveDestinations } from "~/components/drive/use-drive-destinations";
import { NotebookPicker } from "~/components/notebooks/NotebookPicker";
import { useNoteTemplates } from "~/components/notebooks/use-note-templates";
import {
  noteDestinationRows,
  noteInitialDest,
  noteLocationFromDest,
  type ExistingNotebook,
  type MeetingNoteLocation,
  type MeetingNoteState,
  CORE_NOTE_FOLDER_LABEL,
  emptyMeetingNote,
} from "~/calendar/components/meeting-note";

// Shared "meeting note" fields for the create surfaces (CreateEventModal,
// AddMeetingNoteModal, AddMeetingWhiteboardModal). The pure state model +
// payload derivation live in ./meeting-note; this file adds the React hook + UI
// and re-exports them so the parents have a single import site.

export {
  type ExistingNotebook,
  type MeetingNoteLocation,
  type MeetingNoteState,
  CORE_NOTE_FOLDER_LABEL,
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
    setNotebookMode: (notebookMode: MeetingNoteState["notebookMode"]) => patch({ notebookMode }),
    setExisting: (existing: ExistingNotebook | null) => patch({ existing }),
    setTitle: (title: string) => patch({ title, titleEdited: true }),
    // The meeting's own title seeds the notebook name until the organizer types one.
    prefillTitle: (title: string) => setState((s) => (s.titleEdited || s.title === title ? s : { ...s, title })),
    setLocation: (location: MeetingNoteLocation | null) => patch({ location }),
    setTemplatePageId: (templatePageId: string | null) => patch({ templatePageId }),
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
  meetingTitle = "",
  meetingId = null,
}: {
  note: MeetingNoteController;
  myProjects?: { id: string; name: string }[];
  fieldClass: string;
  labelClass: string;
  /** The meeting is a Core meeting. Relabels the "no project" option to
   *  "Core" and files a project-less notebook in Core's folder by default; the
   *  About picker still offers the organizer's projects. */
  core?: boolean;
  /** Seeds the new notebook's name. */
  meetingTitle?: string;
  /** The meeting this note is for, once it exists; sharpens the suggestions. */
  meetingId?: string | null;
}) {
  const { state } = note;

  useEffect(() => {
    if (meetingTitle.trim()) note.prefillTitle(meetingTitle.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingTitle]);

  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const destinations = useDriveDestinations({ enabled: folderPickerOpen, onError: () => setFolderPickerOpen(false) });
  const noteRows = useMemo(() => noteDestinationRows(destinations.rows), [destinations.rows]);
  const isProject = state.about !== "";
  const makingNotebook = state.enabled && state.notebookMode === "new";
  const { templates } = useNoteTemplates({ enabled: makingNotebook, projectId: isProject ? state.about : null });

  function onPickFolder(dest: Destination) {
    const location = noteLocationFromDest(dest, noteRows);
    if (!location) return;
    note.setLocation(location);
    setFolderPickerOpen(false);
  }

  function chooseMode(mode: MeetingNoteState["notebookMode"]) {
    note.setNotebookMode(mode);
    if (mode === "existing" && !state.existing) setNotebookPickerOpen(true);
  }

  const projectName = myProjects.find((p) => p.id === state.about)?.name ?? "Project";
  const defaultLocationLabel = core && !isProject ? CORE_NOTE_FOLDER_LABEL : isProject ? projectName : "Lab-wide / Meeting assets";
  const locationLabel = state.location?.label ?? defaultLocationLabel;
  const showWhiteboardLocation = !state.enabled && state.whiteboard && !isProject && !core;

  const locationRow = (label: string) => (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          {locationLabel}
        </span>
        <button
          type="button"
          onClick={() => setFolderPickerOpen(true)}
          className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/40"
        >
          Change…
        </button>
      </div>
    </div>
  );

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

      {state.enabled && (
        <div>
          <span className={labelClass}>Notebook</span>
          <div className="flex items-center gap-5 pt-1">
            <Radio
              name="meeting-notebook-mode"
              checked={state.notebookMode === "existing"}
              onChange={() => chooseMode("existing")}
              label="Add to existing"
            />
            <Radio
              name="meeting-notebook-mode"
              checked={state.notebookMode === "new"}
              onChange={() => chooseMode("new")}
              label="New notebook"
            />
          </div>

          {state.notebookMode === "existing" ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="flex min-w-0 flex-1 flex-col rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                {state.existing ? (
                  <>
                    <span className="truncate">{state.existing.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{state.existing.path}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No notebook chosen</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setNotebookPickerOpen(true)}
                className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/40"
              >
                {state.existing ? "Change…" : "Choose…"}
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-3">
              <div>
                <label htmlFor="meeting-notebook-name" className={labelClass}>
                  Name
                </label>
                <input
                  id="meeting-notebook-name"
                  type="text"
                  value={state.title}
                  onChange={(e) => note.setTitle(e.target.value)}
                  placeholder="e.g. Weekly check-in"
                  maxLength={200}
                  required
                  className={fieldClass}
                />
              </div>
              {locationRow("Location")}
              <div>
                <span className={labelClass}>Template</span>
                <Select
                  value={state.templatePageId ?? ""}
                  onChange={(v) => note.setTemplatePageId(v || null)}
                  ariaLabel="Notebook template"
                  options={[
                    { value: "", label: "Default template" },
                    ...templates.map((t) => ({ value: t.id, label: t.title })),
                  ]}
                  buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {showWhiteboardLocation && locationRow("Save whiteboard to")}

      {notebookPickerOpen && (
        <NotebookPicker
          open
          projectId={isProject ? state.about : null}
          meetingId={meetingId}
          onClose={() => setNotebookPickerOpen(false)}
          onPick={(picked) => {
            note.setExisting(picked);
            setNotebookPickerOpen(false);
          }}
          onNewInstead={() => {
            note.setNotebookMode("new");
            setNotebookPickerOpen(false);
          }}
        />
      )}

      {folderPickerOpen && destinations.status === "ready" && (
        <FolderPicker
          open
          heading={showWhiteboardLocation ? "Save whiteboard to" : "Save notebook to"}
          drives={noteRows.drives}
          folders={noteRows.folders}
          preferFolderType="Meetings"
          initial={noteInitialDest(state.location, noteRows)}
          confirmLabel="Save here"
          onClose={() => setFolderPickerOpen(false)}
          onConfirm={onPickFolder}
        />
      )}
    </div>
  );
}
