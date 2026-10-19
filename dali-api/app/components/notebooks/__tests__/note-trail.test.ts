import { describe, expect, it } from "vitest";
import { noteTabLabel, noteTrail } from "~/components/notebooks/note-trail";

const location = {
  scopeId: "projects",
  scopeLabel: "Projects",
  folderId: "f1",
  folders: [
    { id: "p1", title: "Project Alpha" },
    { id: "f1", title: "Meetings" },
  ],
  path: "Projects ▸ Project Alpha ▸ Meetings",
};

describe("noteTrail", () => {
  it("links the space, each folder and the notebook, and ends on the unlinked tab", () => {
    expect(noteTrail(location, { id: "nb1", title: "Weekly sync" }, "Oct 14, 2026")).toEqual([
      { label: "Projects", to: "/drive?scope=projects" },
      { label: "Project Alpha", to: "/drive?scope=projects&folder=p1" },
      { label: "Meetings", to: "/drive?scope=projects&folder=f1" },
      { label: "Weekly sync", to: "/documents/nb1" },
      { label: "Oct 14, 2026" },
    ]);
  });

  it("goes straight from the space to the notebook at a space's top level", () => {
    expect(noteTrail({ ...location, folderId: null, folders: [] }, { id: "nb1", title: "Notes" }, "Agenda")).toEqual([
      { label: "Projects", to: "/drive?scope=projects" },
      { label: "Notes", to: "/documents/nb1" },
      { label: "Agenda" },
    ]);
  });
});

describe("noteTabLabel", () => {
  const occurrence = new Date("2026-10-19T18:00:00Z");

  it("shows a renamed meeting note by its title, not its date", () => {
    expect(noteTabLabel({ title: "Project Lighthouse", meetingOccurrenceStart: occurrence })).toBe("Project Lighthouse");
  });

  it("keeps the date a new note was titled with", () => {
    expect(noteTabLabel({ title: "Oct 19, 2026", meetingOccurrenceStart: occurrence })).toBe("Oct 19, 2026");
  });

  it("falls back to the meeting date when the title is cleared", () => {
    expect(noteTabLabel({ title: "", meetingOccurrenceStart: occurrence })).toBe("Oct 19, 2026");
    expect(noteTabLabel({ title: "   ", meetingOccurrenceStart: occurrence })).toBe("Oct 19, 2026");
  });

  it("shows a plain document by its title", () => {
    expect(noteTabLabel({ title: "Alejandro, Leah <> Kiran", meetingOccurrenceStart: null })).toBe("Alejandro, Leah <> Kiran");
  });
});
