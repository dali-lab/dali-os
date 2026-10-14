import { describe, expect, it } from "vitest";
import {
  HISTORY_REASON,
  SERIES_REASON,
  clearPlace,
  defaultNotebookQueryString,
  emptyMeetingNote,
  inviteOf,
  inviteSpaceOf,
  meetingNoteActive,
  meetingNotePayload,
  meetingNoteValid,
  notebookChoiceOf,
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
  type MeetingNoteState,
  type NoteSpace,
  type PlaceNotebook,
} from "~/calendar/components/meeting-note";

const labNb: PlaceNotebook = { id: "nb1", title: "Weekly", path: "General ▸ Meetings", workspaceType: "Lab", workspaceId: null };
const projectNb: PlaceNotebook = {
  id: "nb2",
  title: "Standup",
  path: "Projects ▸ Atlas ▸ Meetings",
  workspaceType: "Project",
  workspaceId: "p1",
};
const atlas: NoteSpace = { workspaceType: "Project", workspaceId: "p1", label: "Atlas" };
const lab: NoteSpace = { workspaceType: "Lab", workspaceId: null, label: "Lab" };
const noInvite = inviteOf([]);

const on = (over: Partial<MeetingNoteState> = {}): MeetingNoteState => ({ ...emptyMeetingNote, enabled: true, ...over });
const existing = (nb: PlaceNotebook, over: Partial<MeetingNoteState> = {}) =>
  on({ place: { kind: "existing", notebook: nb }, ...over });
const fresh = (space: NoteSpace = lab, title = "Sync") => withNewNotebook(on(), space, title);

describe("validity", () => {
  it("accepts anything while notes are off", () => {
    expect(meetingNoteValid(emptyMeetingNote)).toBe(true);
    expect(meetingNoteValid({ ...emptyMeetingNote, whiteboard: true })).toBe(true);
  });

  it("needs a place once notes are on", () => {
    expect(meetingNoteValid(on())).toBe(false);
  });

  it("accepts an existing notebook", () => {
    expect(meetingNoteValid(existing(labNb))).toBe(true);
  });

  it("needs a name for a new notebook", () => {
    expect(meetingNoteValid(fresh(lab, "Sync"))).toBe(true);
    expect(meetingNoteValid(fresh(lab, ""))).toBe(false);
    expect(meetingNoteValid(fresh(lab, "   "))).toBe(false);
  });
});

describe("activity", () => {
  it("counts a note or a whiteboard", () => {
    expect(meetingNoteActive(emptyMeetingNote)).toBe(false);
    expect(meetingNoteActive(on())).toBe(true);
    expect(meetingNoteActive({ ...emptyMeetingNote, whiteboard: true })).toBe(true);
  });
});

describe("meetingNotePayload", () => {
  it("is empty with neither asset", () => {
    expect(meetingNotePayload(emptyMeetingNote, inviteOf([{ projectId: "p1", systemKey: null }]))).toEqual({});
  });

  it("sends an existing notebook by id", () => {
    expect(meetingNotePayload(existing(labNb), noInvite)).toEqual({
      note: true,
      whiteboard: false,
      notebook: { existingId: "nb1" },
    });
  });

  it("sends a new notebook's trimmed title and template", () => {
    const s = withTemplate(withNewNotebook(on(), lab, "  Sync  "), "t1");
    expect(meetingNotePayload(s, noInvite).notebook).toEqual({ title: "Sync", templatePageId: "t1" });
  });

  it("sends only the notebook choice, never places, links or locations", () => {
    const out = meetingNotePayload(fresh(), noInvite);
    expect(Object.keys(out).sort()).toEqual(["note", "notebook", "whiteboard"]);
    expect(Object.keys(out.notebook as object).sort()).toEqual(["templatePageId", "title"]);
  });

  it("takes the project from a single invited group first", () => {
    const invite = inviteOf([{ projectId: "p9", systemKey: null }]);
    expect(meetingNotePayload(existing(projectNb), invite)).toMatchObject({ projectId: "p9" });
  });

  it("falls back to the picked notebook's project", () => {
    expect(meetingNotePayload(existing(projectNb), noInvite)).toMatchObject({ projectId: "p1" });
  });

  it("falls back to a new notebook's project space", () => {
    expect(meetingNotePayload(fresh(atlas), noInvite)).toMatchObject({ projectId: "p1" });
  });

  it("sends no project for the Lab or an unplaced default", () => {
    expect(meetingNotePayload(existing(labNb), noInvite)).not.toHaveProperty("projectId");
    expect(meetingNotePayload(fresh(lab), noInvite)).not.toHaveProperty("projectId");
    expect(
      meetingNotePayload(existing({ id: "d", title: "D", path: "x", workspaceType: null, workspaceId: null }), noInvite),
    ).not.toHaveProperty("projectId");
  });

  it("does not take a project from several invited groups", () => {
    const invite = inviteOf([
      { projectId: "p1", systemKey: null },
      { projectId: "p2", systemKey: null },
    ]);
    expect(invite.projectId).toBeNull();
  });

  it("flags a Core meeting only from the invite", () => {
    const core = inviteOf([{ projectId: null, systemKey: "core" }]);
    expect(meetingNotePayload(existing(labNb), core)).toMatchObject({ isCoreMeeting: true });
    expect(meetingNotePayload(existing(labNb), noInvite)).not.toHaveProperty("isCoreMeeting");
    expect(meetingNotePayload(fresh(), noInvite)).not.toHaveProperty("isCoreMeeting");
  });

  it("flags Core when it is one of several invited groups", () => {
    const invite = inviteOf([
      { projectId: "p1", systemKey: null },
      { projectId: null, systemKey: "core" },
    ]);
    expect(invite).toEqual({ projectId: null, coreInvited: true });
  });

  it("sends a whiteboard alone without a notebook", () => {
    expect(meetingNotePayload({ ...emptyMeetingNote, whiteboard: true }, noInvite)).toEqual({
      note: false,
      whiteboard: true,
    });
  });

  it("sends the notebook with a note enabled but no place only as the missing choice", () => {
    expect(meetingNotePayload(on(), noInvite)).toEqual({ note: true, whiteboard: false });
    expect(notebookChoiceOf(on())).toBeNull();
  });

  it("sends the notebook only while notes are enabled", () => {
    const s = { ...existing(labNb), enabled: false, whiteboard: true };
    expect(meetingNotePayload(s, noInvite)).toEqual({ note: false, whiteboard: true });
  });
});

describe("invite helpers", () => {
  it("names the space of a single project group", () => {
    expect(inviteSpaceOf([{ projectId: "p1", systemKey: null, name: "Atlas" }])).toEqual(atlas);
  });

  it("names Core for the Core group", () => {
    expect(inviteSpaceOf([{ projectId: null, systemKey: "core", name: "Core" }])).toEqual({
      workspaceType: "Lab",
      workspaceId: null,
      label: "Core",
    });
  });

  it("names the Lab otherwise", () => {
    expect(inviteSpaceOf([])).toEqual(lab);
    expect(inviteSpaceOf([{ projectId: null, systemKey: null, name: "Everyone" }])).toEqual(lab);
  });

  it("gives a group's space, or none for a plain group", () => {
    expect(spaceOfGroup({ projectId: "p1", systemKey: null, name: "Atlas" })).toEqual(atlas);
    expect(spaceOfGroup({ projectId: null, systemKey: "core", name: "Core" })?.label).toBe("Core");
    expect(spaceOfGroup({ projectId: null, systemKey: "offering:o1", name: "Studio" })).toBeNull();
  });
});

describe("the place line", () => {
  it("reads title and path for an existing notebook", () => {
    expect(placeLine({ kind: "existing", notebook: projectNb })).toBe("Standup · Projects ▸ Atlas ▸ Meetings");
  });

  it("names a new notebook and its space", () => {
    expect(placeLine(fresh(atlas, " Sync ").place!)).toBe("New notebook “Sync” · Atlas");
  });
});

describe("state transitions", () => {
  it("clears the place and reason when notes are turned off", () => {
    const s = withEnabled(existing(labNb, { reason: "x", auto: true }), false);
    expect(s).toMatchObject({ enabled: false, place: null, reason: null, auto: false });
  });

  it("keeps the whiteboard through turning notes on and off", () => {
    expect(withEnabled({ ...emptyMeetingNote, whiteboard: true }, true).whiteboard).toBe(true);
    expect(withEnabled({ ...on(), whiteboard: true }, false).whiteboard).toBe(true);
  });

  it("picking a notebook replaces the place and marks it manual", () => {
    const s = withPickedNotebook(existing(labNb, { auto: true, reason: SERIES_REASON }), projectNb);
    expect(s).toMatchObject({ place: { kind: "existing", notebook: { id: "nb2" } }, reason: null, auto: false });
  });

  it("starts a new notebook with the given title and space", () => {
    expect(fresh(atlas, "Sync").place).toEqual({
      kind: "new",
      title: "Sync",
      titleEdited: false,
      templatePageId: null,
      space: atlas,
    });
  });

  it("clears a place", () => {
    expect(clearPlace(existing(labNb, { reason: "x" }))).toMatchObject({ place: null, reason: null, auto: false });
  });

  it("ignores title and template edits without a new notebook", () => {
    const s = existing(labNb);
    expect(withTitle(s, "x")).toBe(s);
    expect(withTemplate(s, "t")).toBe(s);
    expect(withPrefilledTitle(s, "x")).toBe(s);
  });
});

describe("the new notebook's title", () => {
  it("follows the meeting title until edited", () => {
    let s = fresh(lab, "Sync");
    s = withPrefilledTitle(s, "Sync 2");
    expect(s.place).toMatchObject({ title: "Sync 2", titleEdited: false });
    s = withTitle(s, "Mine");
    expect(s.place).toMatchObject({ title: "Mine", titleEdited: true });
    s = withPrefilledTitle(s, "Sync 3");
    expect(s.place).toMatchObject({ title: "Mine" });
  });

  it("returns the same state when the title already matches", () => {
    const s = fresh(lab, "Sync");
    expect(withPrefilledTitle(s, "Sync")).toBe(s);
  });

  it("starts unedited again for the next new notebook", () => {
    const edited = withTitle(fresh(lab, "Sync"), "Mine");
    expect(withNewNotebook(edited, lab, "Fresh").place).toMatchObject({ title: "Fresh", titleEdited: false });
  });
});

describe("default seeding", () => {
  const nbRef = { id: "nb7", title: "Weekly", path: "General ▸ Meetings" };
  const def = (kind: DefaultNotebookResult["kind"], notebook: DefaultNotebookResult["notebook"] = nbRef): DefaultNotebookResult => ({
    kind,
    notebook,
    newPath: "General",
  });

  it("fills the place from the series notebook", () => {
    const s = withDefault(on(), def("series"));
    expect(s).toMatchObject({
      place: { kind: "existing", notebook: { id: "nb7", title: "Weekly", path: "General ▸ Meetings" } },
      reason: "this meeting's notebook",
      auto: true,
    });
    expect(SERIES_REASON).toBe("this meeting's notebook");
  });

  it("fills the place from the group's history", () => {
    expect(withDefault(on(), def("history"))).toMatchObject({ reason: "last used by this group", auto: true });
    expect(HISTORY_REASON).toBe("last used by this group");
  });

  it("leaves the place empty for a new default", () => {
    const s = on();
    expect(withDefault(s, def("new", null))).toBe(s);
  });

  it("never creates a notebook for a new default", () => {
    expect(withDefault(on(), def("new", null)).place).toBeNull();
  });

  it("does not replace a place the organizer picked", () => {
    const s = withPickedNotebook(on(), projectNb);
    expect(withDefault(s, def("series"))).toBe(s);
    const made = fresh();
    expect(withDefault(made, def("series"))).toBe(made);
  });

  it("replaces an auto-set place with a newer default", () => {
    const first = withDefault(on(), def("history"));
    const next = withDefault(first, def("series", { id: "nb8", title: "Other", path: "x" }));
    expect(next.place).toMatchObject({ notebook: { id: "nb8" } });
    expect(next.reason).toBe(SERIES_REASON);
  });

  it("drops an auto-set place when the default becomes new", () => {
    const first = withDefault(on(), def("history"));
    expect(withDefault(first, def("new", null))).toMatchObject({ place: null, reason: null, auto: false });
  });
});

describe("default query", () => {
  it("asks about a group invite", () => {
    const qs = new URLSearchParams(
      defaultNotebookQueryString({ meetingId: "m1", scopeGroupId: "g1", invite: { projectId: "p1", coreInvited: true } }),
    );
    expect(Object.fromEntries(qs)).toEqual({
      scopeType: "Group",
      groupId: "g1",
      meetingId: "m1",
      projectId: "p1",
      isCoreMeeting: "1",
    });
  });

  it("asks about a people list", () => {
    const qs = new URLSearchParams(defaultNotebookQueryString({ scopeGroupId: null, invite: noInvite }));
    expect(Object.fromEntries(qs)).toEqual({ scopeType: "UserList" });
  });
});
