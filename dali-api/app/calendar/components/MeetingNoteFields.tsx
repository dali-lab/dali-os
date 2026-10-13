import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { Radio } from "~/components/ui/Radio";
import { FolderPicker, type Destination } from "~/components/drive/FolderPicker";
import { useDriveDestinations } from "~/components/drive/use-drive-destinations";
import { NotebookPicker } from "~/components/notebooks/NotebookPicker";
import { useNoteTemplates } from "~/components/notebooks/use-note-templates";
import { FiledInChips } from "~/calendar/components/FiledInChips";
import {
  addPlace,
  defaultPlaceFor,
  groupFilingDest,
  hasPlace,
  makePrimaryPlace,
  noteDestinationRows,
  noteInitialDest,
  noteLocationFromDest,
  placeFromDest,
  placesFromPicker,
  removePlace,
  type ExistingNotebook,
  type FilingPlace,
  type MeetingNoteLocation,
  type MeetingNoteState,
  emptyMeetingNote,
} from "~/calendar/components/meeting-note";
import { suggestFiling } from "~/calendar/lib/suggest-filing";
import type { GroupOption } from "~/calendar/lib/types";

// Shared "meeting note" fields for the create surfaces (CreateEventModal,
// AddMeetingNoteModal, AddMeetingWhiteboardModal). The pure state model +
// payload derivation live in ./meeting-note; this file adds the React hook + UI
// and re-exports them so the parents have a single import site.

export {
  type ExistingNotebook,
  type FilingPlace,
  type MeetingNoteLocation,
  type MeetingNoteState,
  emptyMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
} from "~/calendar/components/meeting-note";

export type MeetingNoteController = ReturnType<typeof useMeetingNote>;

export type NoteChoice = "none" | MeetingNoteState["notebookMode"];

export function useMeetingNote() {
  const [state, setState] = useState<MeetingNoteState>(emptyMeetingNote);
  const patch = (p: Partial<MeetingNoteState>) => setState((s) => ({ ...s, ...p }));
  const seedPlace = useCallback(
    (place: FilingPlace | null) =>
      setState((s) => {
        const same = place ? s.places.length === 1 && hasPlace(s.places, place.dest) : s.places.length === 0;
        return s.placesTouched || same ? s : { ...s, places: place ? [place] : [] };
      }),
    [],
  );
  const editPlaces = (edit: (places: FilingPlace[]) => FilingPlace[]) =>
    setState((s) => ({ ...s, places: edit(s.places), placesTouched: true }));
  return {
    state,
    setEnabled: (enabled: boolean) => patch({ enabled }),
    setChoice: (choice: NoteChoice) =>
      choice === "none"
        ? patch({ enabled: false, whiteboard: false })
        : patch({ enabled: true, notebookMode: choice }),
    setWhiteboard: (whiteboard: boolean) => patch({ whiteboard }),
    setAbout: (about: string) => patch({ about }),
    setExisting: (existing: ExistingNotebook | null) => patch({ existing }),
    setTitle: (title: string) => patch({ title, titleEdited: true }),
    // The meeting's own title seeds the notebook name until the organizer types one.
    prefillTitle: (title: string) => setState((s) => (s.titleEdited || s.title === title ? s : { ...s, title })),
    setLocation: (location: MeetingNoteLocation | null) => patch({ location }),
    setTemplatePageId: (templatePageId: string | null) => patch({ templatePageId }),
    // Prefill "About" from a single invited project group — a default, not a lock:
    // only fills when the organizer hasn't already chosen an About, and never
    // touches the note choice (notes stay opt-in).
    applyGroupPrefill: (projectId: string | null) =>
      setState((s) => (projectId && s.about === "" ? { ...s, about: projectId } : s)),
    // The place About points at, until the organizer picks their own.
    seedPlace,
    setPlaces: (places: FilingPlace[]) => editPlaces(() => places),
    addPlace: (place: FilingPlace) => editPlaces((places) => addPlace(places, place)),
    removePlace: (place: FilingPlace) => editPlaces((places) => removePlace(places, place.dest)),
    makePrimary: (place: FilingPlace) => editPlaces((places) => makePrimaryPlace(places, place.dest)),
    reset: () => setState(emptyMeetingNote),
  };
}

/** Who is invited and which groups exist, so the block can suggest where to file. */
export type FilingSuggestionInput = { attendeeIds: string[]; groups: GroupOption[] };

export function MeetingNoteFields({
  note,
  surface = "note",
  myProjects = [],
  fieldClass,
  labelClass,
  meetingTitle = "",
  meetingId = null,
  suggest,
}: {
  note: MeetingNoteController;
  /** "create" can skip the note and start a whiteboard with it; "note" always
   *  makes a note; "whiteboard" is a board with no note, filed by About. */
  surface?: "create" | "note" | "whiteboard";
  myProjects?: { id: string; name: string }[];
  fieldClass: string;
  labelClass: string;
  /** Seeds the new notebook's name and feeds the filing suggestions. */
  meetingTitle?: string;
  /** The meeting this note is for, once it exists; sharpens the suggestions. */
  meetingId?: string | null;
  suggest?: FilingSuggestionInput;
}) {
  const { state } = note;

  useEffect(() => {
    if (meetingTitle.trim()) note.prefillTitle(meetingTitle.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingTitle]);

  const [placesPickerOpen, setPlacesPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const destinations = useDriveDestinations({
    enabled: state.enabled || boardPickerOpen,
    onError: () => {
      setPlacesPickerOpen(false);
      setBoardPickerOpen(false);
    },
  });
  const noteRows = useMemo(() => noteDestinationRows(destinations.rows), [destinations.rows]);
  const rowsReady = destinations.status === "ready";
  const isProject = state.about !== "";
  const existingNotebook = state.notebookMode === "existing";
  const makingNotebook = state.enabled && !existingNotebook;
  const { templates } = useNoteTemplates({ enabled: makingNotebook, projectId: isProject ? state.about : null });

  const { seedPlace } = note;
  useEffect(() => {
    if (!state.enabled || !rowsReady || state.placesTouched) return;
    seedPlace(existingNotebook ? null : defaultPlaceFor(state.about, noteRows));
  }, [state.enabled, rowsReady, state.placesTouched, existingNotebook, state.about, noteRows, seedPlace]);

  const suggestions = useMemo(() => {
    if (!suggest || !state.enabled || !rowsReady) return [];
    const placeByGroup = new Map<string, FilingPlace>();
    for (const g of suggest.groups) {
      const dest = groupFilingDest(g, noteRows);
      const place = dest && !hasPlace(state.places, dest) ? placeFromDest(dest, noteRows) : null;
      if (place) placeByGroup.set(g.id, place);
    }
    return suggestFiling({
      attendeeIds: suggest.attendeeIds,
      groups: suggest.groups.filter((g) => placeByGroup.has(g.id)),
      title: meetingTitle,
    }).map((s) => ({ ...s, place: placeByGroup.get(s.groupId)! }));
  }, [suggest, state.enabled, rowsReady, noteRows, state.places, meetingTitle]);

  function chooseNote(choice: "none" | "new" | "existing") {
    note.setChoice(choice);
    if (choice === "existing" && !state.existing) setNotebookPickerOpen(true);
  }

  function onPickBoardFolder(dest: Destination) {
    const location = noteLocationFromDest(dest, noteRows);
    if (!location) return;
    note.setLocation(location);
    setBoardPickerOpen(false);
  }

  const aboutField = (
    <div>
      <span className={labelClass}>About</span>
      <Select
        value={state.about}
        onChange={(v) => note.setAbout(v)}
        options={[{ value: "", label: "General (no project)" }, ...myProjects.map((p) => ({ value: p.id, label: p.name }))]}
        buttonClassName={`${fieldClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
      />
    </div>
  );

  const notebookPicker = notebookPickerOpen && (
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
        note.setChoice("new");
        setNotebookPickerOpen(false);
      }}
    />
  );

  if (surface === "whiteboard") {
    return (
      <div className="space-y-3">
        {aboutField}
        {!isProject && (
          <div>
            <span className={labelClass}>Save whiteboard to</span>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                {state.location?.label ?? "Lab-wide / Meeting assets"}
              </span>
              <button
                type="button"
                onClick={() => setBoardPickerOpen(true)}
                className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/40"
              >
                Change…
              </button>
            </div>
          </div>
        )}
        {boardPickerOpen && rowsReady && (
          <FolderPicker
            open
            heading="Save whiteboard to"
            drives={noteRows.drives}
            folders={noteRows.folders}
            preferFolderType="Meetings"
            initial={noteInitialDest(state.location, noteRows)}
            confirmLabel="Save here"
            onClose={() => setBoardPickerOpen(false)}
            onConfirm={onPickBoardFolder}
          />
        )}
      </div>
    );
  }

  const choice: NoteChoice = state.enabled ? state.notebookMode : "none";

  return (
    <div className="space-y-3">
      <div>
        <span className={labelClass}>Notes</span>
        <div role="radiogroup" aria-label="Notes" className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1">
          {surface === "create" && (
            <Radio name="meeting-notes-choice" checked={choice === "none"} onChange={() => chooseNote("none")} label="No note" />
          )}
          <Radio name="meeting-notes-choice" checked={choice === "new"} onChange={() => chooseNote("new")} label="New notebook" />
          <Radio
            name="meeting-notes-choice"
            checked={choice === "existing"}
            onChange={() => chooseNote("existing")}
            label="Add to existing notebook"
          />
        </div>
      </div>

      {state.enabled && (
        <>
          {aboutField}

          {existingNotebook ? (
            <div className="flex items-center gap-2">
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
            <div className="space-y-3">
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

          {surface === "create" && (
            <Checkbox
              checked={state.whiteboard}
              onChange={(e) => note.setWhiteboard(e.target.checked)}
              label="Also start a whiteboard"
            />
          )}

          <FiledInChips
            places={state.places}
            existingNotebook={existingNotebook}
            suggestions={suggestions}
            labelClass={labelClass}
            onPickSuggestion={(groupId) => {
              const picked = suggestions.find((s) => s.groupId === groupId);
              if (picked) note.addPlace(picked.place);
            }}
            onMakePrimary={note.makePrimary}
            onRemove={note.removePlace}
            onAdd={() => setPlacesPickerOpen(true)}
          />
        </>
      )}

      {notebookPicker}

      {placesPickerOpen && rowsReady && (
        <FolderPicker
          open
          mode="multi"
          heading={existingNotebook ? "Also link the notebook in" : "File the notebook in"}
          drives={noteRows.drives}
          folders={noteRows.folders}
          preferFolderType="Meetings"
          initialDestinations={state.places.map((p) => p.dest)}
          confirmLabel="Save"
          onClose={() => setPlacesPickerOpen(false)}
          onConfirm={(result) => {
            note.setPlaces(placesFromPicker(result, state.places, noteRows));
            setPlacesPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
