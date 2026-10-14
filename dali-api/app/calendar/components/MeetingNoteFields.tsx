import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
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
  fetchPairNotebook,
  inviteOf,
  inviteSpaceOf,
  pickerSpaceOf,
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
import { suggestFiling, suggestPairFiling, type PairSuggestion } from "~/calendar/lib/suggest-filing";
import type { GroupOption, MentorPairOption } from "~/calendar/lib/types";

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
  viewerId?: string;
  mentorPairs?: MentorPairOption[];
};

type PickerRequest = { space: NoteSpace | null; newLabel: string; newSpace: NoteSpace };

const chipClass =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted/60";

type GroupChip = { groupId: string; label: string; reason: string; space: NoteSpace };

function FilingOptions({
  chips,
  pairChip,
  error,
  onChip,
  onPair,
  onSearch,
  onNew,
}: {
  chips: GroupChip[];
  pairChip: PairSuggestion | null;
  error: string | null;
  onChip: (space: NoteSpace) => void;
  onPair: (menteeId: string) => void;
  onSearch: () => void;
  onNew?: () => void;
}) {
  return (
    <div className="space-y-2">
      {(pairChip || chips.length > 0) && (
        <ul aria-label="Suggested notebooks" className="flex flex-wrap gap-1.5">
          {pairChip && (
            <li>
              <button type="button" onClick={() => onPair(pairChip.menteeId)} className={chipClass}>
                <Plus className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{pairChip.label}</span>
                <span className="text-muted-foreground">{pairChip.reason}</span>
              </button>
            </li>
          )}
          {chips.map((c) => (
            <li key={c.groupId}>
              <button type="button" onClick={() => onChip(c.space)} className={chipClass}>
                <Plus className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{c.label}</span>
                <span className="text-muted-foreground">{c.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onSearch}>
          <Search className="h-3.5 w-3.5" aria-hidden />
          Search notebooks
        </Button>
        {onNew && (
          <Button variant="secondary" size="sm" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New notebook
          </Button>
        )}
      </div>
    </div>
  );
}

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
  const [pairError, setPairError] = useState<string | null>(null);

  useEffect(() => {
    if (meetingTitle.trim()) note.prefillTitle(meetingTitle.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingTitle]);

  const pairChip = useMemo(() => {
    if (!suggest || !state.enabled) return null;
    return suggestPairFiling({
      attendeeIds: suggest.attendeeIds,
      viewerId: suggest.viewerId ?? "",
      groupsInvited: suggest.invitedGroups.length > 0,
      pairs: suggest.mentorPairs ?? [],
    });
  }, [suggest, state.enabled]);
  const pairMenteeId = pairChip?.menteeId ?? null;

  const manual = place !== null && !state.auto;
  const onLoaded = useRef(onDefaultLoaded);
  onLoaded.current = onDefaultLoaded;
  useEffect(() => {
    if (!state.enabled || manual) return;
    let cancelled = false;
    fetchDefaultNotebook({ meetingId, scopeGroupId, invite, pairMenteeId })
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
  }, [state.enabled, manual, meetingId, scopeGroupId, invite.projectId, invite.coreInvited, pairMenteeId]);

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

  async function pickPair(menteeId: string) {
    setPairError(null);
    try {
      note.pickNotebook(await fetchPairNotebook(menteeId));
    } catch {
      setPairError("Couldn't open that notebook. Try Search notebooks.");
    }
  }

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
      space={picker.space && pickerSpaceOf(picker.space)}
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

  const options = (
    <FilingOptions
      chips={chips}
      pairChip={pairChip}
      error={pairError}
      onChip={openPicker}
      onPair={pickPair}
      onSearch={() => openPicker(null)}
      onNew={canCreateNew ? () => note.startNew(inviteSpace, meetingTitle.trim()) : undefined}
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
      {options}
    </div>
  ) : (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{PICK_PLACE_COPY}</p>
      {options}
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
