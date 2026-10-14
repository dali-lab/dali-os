import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { Segmented } from "~/components/ui/Segmented";
import { FolderPicker, type Destination } from "~/components/drive/FolderPicker";
import { useDriveDestinations } from "~/components/drive/use-drive-destinations";
import { IconButton } from "~/components/ui/IconButton";
import { NotebookPicker } from "~/components/notebooks/NotebookPicker";
import { useNotebookList } from "~/components/notebooks/use-notebook-list";
import { useNoteTemplates } from "~/components/notebooks/use-note-templates";
import { FiledInChips } from "~/calendar/components/FiledInChips";
import {
  addPlace,
  defaultPlaceFor,
  groupFilingDest,
  hasPlace,
  makePrimaryPlace,
  meetingNoteActive,
  noteDestinationRows,
  notebookHomePlace,
  placeFromDest,
  placesFromPicker,
  projectIdOf,
  removePlace,
  reorderPlaces,
  withHomeOnTop,
  withoutPlace,
  type ExistingNotebook,
  type FilingPlace,
  type MeetingNoteState,
  emptyMeetingNote,
} from "~/calendar/components/meeting-note";
import { suggestFiling } from "~/calendar/lib/suggest-filing";
import type { GroupOption } from "~/calendar/lib/types";

// Shared meeting-asset fields (note and whiteboard) for the create surfaces
// (CreateEventModal, AddMeetingNoteModal, AddMeetingWhiteboardModal). The pure
// state model + payload derivation live in ./meeting-note; this file adds the
// React hook + UI and re-exports them so the parents have a single import site.

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
    setEnabled: (enabled: boolean) =>
      setState((s) => {
        if (enabled) {
          return { ...s, enabled, places: s.notebookMode === "existing" ? withHomeOnTop(s.places, s.existingHome) : s.places };
        }
        return { ...s, enabled, places: s.notebookMode === "existing" ? [] : s.places.slice(0, 1) };
      }),
    // Switching to an existing notebook puts its own place on top; switching away takes it off.
    setNotebookMode: (notebookMode: MeetingNoteState["notebookMode"]) =>
      setState((s) =>
        s.notebookMode === notebookMode
          ? s
          : {
              ...s,
              notebookMode,
              places:
                notebookMode === "existing" && s.existing
                  ? withHomeOnTop(s.places, s.existingHome)
                  : withoutPlace(s.places, s.existingHome),
            },
      ),
    setWhiteboard: (whiteboard: boolean) => patch({ whiteboard }),
    // `home` is the notebook's own place as a row; without it the notebook stays where it is.
    setExisting: (existing: ExistingNotebook | null, home: FilingPlace | null = null) =>
      setState((s) => {
        const rest = withoutPlace(s.places, s.existingHome);
        return {
          ...s,
          existing,
          existingHome: existing ? home : null,
          places: existing ? withHomeOnTop(rest, home) : rest,
        };
      }),
    setTitle: (title: string) => patch({ title, titleEdited: true }),
    // The meeting's own title seeds the notebook name until the organizer types one.
    prefillTitle: (title: string) => setState((s) => (s.titleEdited || s.title === title ? s : { ...s, title })),
    setTemplatePageId: (templatePageId: string | null) => patch({ templatePageId }),
    // The invited project's place, until the organizer picks their own.
    seedPlace,
    setPlaces: (places: FilingPlace[]) => editPlaces(() => places),
    addPlace: (place: FilingPlace) => editPlaces((places) => addPlace(places, place)),
    removePlace: (place: FilingPlace) => editPlaces((places) => removePlace(places, place.dest)),
    makeLocation: (place: FilingPlace) => editPlaces((places) => makePrimaryPlace(places, place.dest)),
    reorderPlaces: (from: number, to: number) => editPlaces((places) => reorderPlaces(places, from, to)),
    reset: () => setState(emptyMeetingNote),
  };
}

/** Who is invited and which groups exist, so the block can suggest where to file. */
export type FilingSuggestionInput = { attendeeIds: string[]; groups: GroupOption[] };

const LAB_TOP: Destination = { driveId: "lab", folderId: null };

const secondaryButtonClass =
  "shrink-0 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/40";

export function MeetingNoteFields({
  note,
  surface = "note",
  fieldClass,
  labelClass,
  meetingTitle = "",
  meetingId = null,
  suggest,
  prefillProjectId = null,
}: {
  note: MeetingNoteController;
  /** "create" renders the Notebook and Whiteboard checkbox rows for the caller's
   *  "Add to this meeting" well; "note" always makes a note; "whiteboard" is a
   *  board with no note. */
  surface?: "create" | "note" | "whiteboard";
  fieldClass: string;
  labelClass: string;
  /** Seeds the new notebook's name and feeds the filing suggestions. */
  meetingTitle?: string;
  /** The meeting this note is for, once it exists; sharpens the suggestions. */
  meetingId?: string | null;
  suggest?: FilingSuggestionInput;
  /** The project the invited group belongs to: its Meetings folder is the
   *  default place until the organizer chooses one. */
  prefillProjectId?: string | null;
}) {
  const { state } = note;

  useEffect(() => {
    if (meetingTitle.trim()) note.prefillTitle(meetingTitle.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingTitle]);

  const [placesPickerOpen, setPlacesPickerOpen] = useState(false);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const active = meetingNoteActive(state) || surface === "whiteboard";
  const destinations = useDriveDestinations({
    enabled: active,
    onError: () => setPlacesPickerOpen(false),
  });
  const noteRows = useMemo(() => noteDestinationRows(destinations.rows), [destinations.rows]);
  const rowsReady = destinations.status === "ready";
  const existingNotebook = state.enabled && state.notebookMode === "existing";
  const boardOnly = !state.enabled && active;
  const makingNotebook = state.enabled && !existingNotebook;
  const projectId = projectIdOf(state);
  const { templates } = useNoteTemplates({ enabled: makingNotebook, projectId });
  const notebookList = useNotebookList({
    enabled: state.enabled,
    projectId: projectId ?? prefillProjectId,
    meetingId,
  });

  const { seedPlace } = note;
  const hasExisting = state.existing !== null;
  useEffect(() => {
    if (!active || !rowsReady || state.placesTouched || (existingNotebook && hasExisting)) return;
    seedPlace(existingNotebook ? null : defaultPlaceFor(prefillProjectId, noteRows));
  }, [active, rowsReady, state.placesTouched, existingNotebook, hasExisting, prefillProjectId, noteRows, seedPlace]);

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

  function chooseMode(mode: MeetingNoteState["notebookMode"]) {
    note.setNotebookMode(mode);
    if (mode === "existing" && !state.existing) setNotebookPickerOpen(true);
  }

  const notebookPicker = notebookPickerOpen && (
    <NotebookPicker
      open
      projectId={projectId ?? prefillProjectId}
      meetingId={meetingId}
      preloaded={notebookList}
      onClose={() => setNotebookPickerOpen(false)}
      onPick={(picked) => {
        note.setExisting(picked, notebookHomePlace(picked, noteRows));
        setNotebookPickerOpen(false);
      }}
      onNewInstead={() => {
        note.setNotebookMode("new");
        setNotebookPickerOpen(false);
      }}
    />
  );

  const fixedLocation = existingNotebook ? (state.existing ? (state.existingHome ? undefined : state.existing.path) : null) : undefined;

  const filedIn = (
    <FiledInChips
      places={boardOnly ? state.places.slice(0, 1) : state.places}
      fixedLocation={fixedLocation}
      lockTop={existingNotebook && !!state.existingHome}
      boardOnly={boardOnly}
      suggestions={suggestions}
      labelClass={labelClass}
      onPickSuggestion={(groupId) => {
        const picked = suggestions.find((s) => s.groupId === groupId);
        if (picked) note.addPlace(picked.place);
      }}
      onMakeLocation={note.makeLocation}
      onReorder={note.reorderPlaces}
      onRemove={note.removePlace}
      onAdd={() => setPlacesPickerOpen(true)}
    />
  );

  const placesPicker =
    placesPickerOpen &&
    rowsReady &&
    (boardOnly ? (
      <FolderPicker
        open
        heading="Save whiteboard to"
        drives={noteRows.drives}
        folders={noteRows.folders}
        preferFolderType="Meetings"
        initial={state.places[0]?.dest ?? LAB_TOP}
        confirmLabel="Save here"
        onClose={() => setPlacesPickerOpen(false)}
        onConfirm={(dest) => {
          const place = placeFromDest(dest, noteRows);
          if (!place) return;
          note.setPlaces([place]);
          setPlacesPickerOpen(false);
        }}
      />
    ) : (
      <FolderPicker
        open
        mode="multi"
        heading={existingNotebook ? "Notebook location and shortcuts" : "File the notebook in"}
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
    ));

  if (surface === "whiteboard") {
    return (
      <div className="space-y-3">
        {filedIn}
        {placesPicker}
      </div>
    );
  }

  const modeChoice = (
    <Segmented
      ariaLabel="Notebook"
      value={state.notebookMode}
      onChange={chooseMode}
      options={[
        { value: "new", label: "New" },
        { value: "existing", label: "Existing" },
      ]}
    />
  );

  const notebookDetails = existingNotebook ? (
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
      <button type="button" onClick={() => setNotebookPickerOpen(true)} className={secondaryButtonClass}>
        {state.existing ? "Change…" : "Choose…"}
      </button>
      {state.existing && (
        <IconButton label="Remove notebook" icon={X} className="shrink-0" onClick={() => note.setExisting(null)} />
      )}
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
  );

  const notebookBody = (
    <div className="space-y-3">
      {modeChoice}
      {notebookDetails}
      {filedIn}
    </div>
  );

  if (surface === "note") {
    return (
      <div className="space-y-3">
        {state.enabled && notebookBody}
        {notebookPicker}
        {placesPicker}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Checkbox
          checked={state.enabled}
          onChange={(e) => note.setEnabled(e.target.checked)}
          label="Notebook"
          description="Shared meeting notes, one tab per meeting."
        />
        {state.enabled && <div className="mt-3 pl-6">{notebookBody}</div>}
      </div>
      <div>
        <Checkbox
          checked={state.whiteboard}
          onChange={(e) => note.setWhiteboard(e.target.checked)}
          label="Whiteboard"
          description="A shared whiteboard, filed with the notebook."
        />
        {boardOnly && state.whiteboard && <div className="mt-3 pl-6">{filedIn}</div>}
      </div>
      {notebookPicker}
      {placesPicker}
    </div>
  );
}
