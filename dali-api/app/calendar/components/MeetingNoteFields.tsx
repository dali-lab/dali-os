import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { Button } from "~/components/ui/Button";
import { NotebookPicker } from "~/components/notebooks/NotebookPicker";
import { useNoteTemplates } from "~/components/notebooks/use-note-templates";
import {
  PICK_PLACE_COPY,
  clearPlace,
  emptyMeetingNote,
  fetchDefaultNotebook,
  inviteOf,
  inviteSpaceOf,
  placeLine,
  spaceOfGroup,
  withDefault,
  withEnabled,
  withNewNotebook,
  withPickedNotebook,
  withPrefilledTitle,
  withTemplate,
  withTitle,
  type DefaultNotebookResult,
  type NoteSpace,
  type PlaceNotebook,
} from "~/calendar/components/meeting-note";
import { suggestFiling } from "~/calendar/lib/suggest-filing";
import type { GroupOption } from "~/calendar/lib/types";

export {
  type MeetingNoteState,
  type MeetingPlace,
  type NoteInvite,
  emptyMeetingNote,
  inviteOf,
  meetingNoteValid,
  meetingNotePayload,
} from "~/calendar/components/meeting-note";

export type MeetingNoteController = ReturnType<typeof useMeetingNote>;

export function useMeetingNote() {
  const [state, setState] = useState(emptyMeetingNote);
  return {
    state,
    setEnabled: (enabled: boolean) => setState((s) => withEnabled(s, enabled)),
    setWhiteboard: (whiteboard: boolean) => setState((s) => ({ ...s, whiteboard })),
    pickNotebook: (notebook: PlaceNotebook, reason: string | null = null) =>
      setState((s) => withPickedNotebook(s, notebook, reason)),
    startNew: (space: NoteSpace, title: string) => setState((s) => withNewNotebook(s, space, title)),
    setTitle: (title: string) => setState((s) => withTitle(s, title)),
    prefillTitle: (title: string) => setState((s) => withPrefilledTitle(s, title)),
    setTemplatePageId: (templatePageId: string | null) => setState((s) => withTemplate(s, templatePageId)),
    applyDefault: (def: DefaultNotebookResult) => setState((s) => withDefault(s, def)),
    clearPlace: () => setState(clearPlace),
    reset: () => setState(emptyMeetingNote),
  };
}

export type FilingSuggestionInput = {
  attendeeIds: string[];
  groups: GroupOption[];
  invitedGroups: GroupOption[];
  scopeGroupId: string | null;
};

type PickerRequest = { space: NoteSpace | null; newLabel: string; newSpace: NoteSpace };

const chipClass =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted/60";

export function MeetingNoteFields({
  note,
  surface = "note",
  fieldClass,
  labelClass,
  meetingTitle = "",
  meetingId = null,
  suggest,
  onDefaultLoaded,
}: {
  note: MeetingNoteController;
  /** "create" adds the Meeting notes and Whiteboard checkboxes; "note" always
   *  makes a note; "edit" changes the notebook an existing meeting files into. */
  surface?: "create" | "note" | "edit";
  fieldClass: string;
  labelClass: string;
  meetingTitle?: string;
  meetingId?: string | null;
  suggest?: FilingSuggestionInput;
  onDefaultLoaded?: (def: DefaultNotebookResult) => void;
}) {
  const { state } = note;
  const { place } = state;
  const canCreateNew = surface !== "edit";
  const invitedGroups = suggest?.invitedGroups ?? [];
  const scopeGroupId = suggest?.scopeGroupId ?? null;
  const invite = inviteOf(invitedGroups);
  const inviteSpace = inviteSpaceOf(invitedGroups);
  const [picker, setPicker] = useState<PickerRequest | null>(null);

  useEffect(() => {
    if (meetingTitle.trim()) note.prefillTitle(meetingTitle.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingTitle]);

  const manual = place !== null && !state.auto;
  const onLoaded = useRef(onDefaultLoaded);
  onLoaded.current = onDefaultLoaded;
  useEffect(() => {
    if (!state.enabled || manual) return;
    let cancelled = false;
    fetchDefaultNotebook({ meetingId, scopeGroupId, invite })
      .then((def) => {
        if (cancelled) return;
        note.applyDefault(def);
        onLoaded.current?.(def);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.enabled, manual, meetingId, scopeGroupId, invite.projectId, invite.coreInvited]);

  const chips = useMemo(() => {
    if (!suggest || !state.enabled) return [];
    return suggestFiling({ attendeeIds: suggest.attendeeIds, groups: suggest.groups, title: meetingTitle }).flatMap((s) => {
      const group = suggest.groups.find((g) => g.id === s.groupId);
      const space = group ? spaceOfGroup(group) : null;
      return space ? [{ ...s, space }] : [];
    });
  }, [suggest, state.enabled, meetingTitle]);

  const templateProject = place?.kind === "new" && place.space.workspaceType === "Project" ? place.space.workspaceId : null;
  const { templates } = useNoteTemplates({ enabled: place?.kind === "new", projectId: templateProject });

  function openPicker(space: NoteSpace | null) {
    setPicker({
      space,
      newLabel: space ? `New notebook in ${space.label}` : "New notebook…",
      newSpace: space ?? inviteSpace,
    });
  }

  const pickerModal = picker && (
    <NotebookPicker
      open
      space={picker.space}
      meetingId={meetingId}
      heading={picker.space ? `Notebooks in ${picker.space.label}` : "Add to a notebook"}
      newRow={
        canCreateNew
          ? {
              label: picker.newLabel,
              onNew: () => {
                note.startNew(picker.newSpace, meetingTitle.trim());
                setPicker(null);
              },
            }
          : undefined
      }
      onClose={() => setPicker(null)}
      onPick={(picked) => {
        note.pickNotebook(picked);
        setPicker(null);
      }}
    />
  );

  const placeRow = place ? (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate text-foreground">{placeLine(place)}</p>
          {state.reason && <p className="truncate text-xs text-muted-foreground">{state.reason}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => openPicker(null)}>
          Change
        </Button>
      </div>
      {place.kind === "new" && (
        <div className="space-y-3">
          <div>
            <label htmlFor="meeting-notebook-name" className={labelClass}>
              Name
            </label>
            <input
              id="meeting-notebook-name"
              type="text"
              value={place.title}
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
              value={place.templatePageId ?? ""}
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
  ) : (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{PICK_PLACE_COPY}</p>
      {chips.length > 0 && (
        <ul aria-label="Suggested notebooks" className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={c.groupId}>
              <button type="button" onClick={() => openPicker(c.space)} className={chipClass}>
                <Plus className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{c.label}</span>
                <span className="text-muted-foreground">{c.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-3">
        <Button variant="ghost" size="xs" onClick={() => openPicker(null)} className="-ml-2.5">
          Search notebooks
        </Button>
        {canCreateNew && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => note.startNew(inviteSpace, meetingTitle.trim())}
            className="-ml-2.5"
          >
            Or create a new notebook for this meeting's notes
          </Button>
        )}
      </div>
    </div>
  );

  if (surface !== "create") {
    return (
      <div className="space-y-3">
        {surface === "edit" && <span className={labelClass}>Meeting notes</span>}
        {placeRow}
        {pickerModal}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Checkbox
          checked={state.enabled}
          onChange={(e) => note.setEnabled(e.target.checked)}
          label="Meeting notes"
          description="One shared note per meeting, kept in a notebook."
        />
        {state.enabled && <div className="mt-3 pl-6">{placeRow}</div>}
      </div>
      <Checkbox
        checked={state.whiteboard}
        onChange={(e) => note.setWhiteboard(e.target.checked)}
        label="Whiteboard"
        description="A shared whiteboard, filed with the notebook."
      />
      {pickerModal}
    </div>
  );
}
