import { describe, expect, it } from "vitest";
import { noteTrail } from "~/components/notebooks/note-trail";

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
