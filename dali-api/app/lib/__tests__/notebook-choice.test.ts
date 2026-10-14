import { describe, it, expect } from "vitest";
import { isExistingChoice, notebookChoiceSchema } from "~/lib/notebook-choice";
import { AddMeetingNoteSchema, AddMeetingWhiteboardSchema } from "~/lib/calendar-schemas";

describe("notebookChoiceSchema", () => {
  it("accepts an existing notebook by id", () => {
    expect(notebookChoiceSchema.parse({ existingId: "nb_1" })).toEqual({ existingId: "nb_1" });
  });

  it("accepts a new notebook with only a name, trimmed", () => {
    expect(notebookChoiceSchema.parse({ title: "  Standup " })).toEqual({ title: "Standup" });
  });

  it("accepts a new notebook with a template or a null template", () => {
    expect(notebookChoiceSchema.parse({ title: "A", templatePageId: "t" })).toEqual({ title: "A", templatePageId: "t" });
    expect(notebookChoiceSchema.safeParse({ title: "A", templatePageId: null }).success).toBe(true);
  });

  it.each([
    [{ kind: "lab" }],
    [{ kind: "core" }],
    [{ kind: "project", projectId: "p1" }],
  ])("accepts a new notebook in the space %j", (space) => {
    expect(notebookChoiceSchema.parse({ title: "A", space })).toEqual({ title: "A", space });
  });

  it.each([
    ["an unknown space kind", { kind: "member" }],
    ["a project space without a project", { kind: "project" }],
    ["a project space with an empty project", { kind: "project", projectId: "" }],
    ["a core space carrying a project", { kind: "core", projectId: "p1" }],
    ["a lab space carrying a project", { kind: "lab", projectId: "p1" }],
    ["a space with no kind", {}],
    ["a bare string", "core"],
  ])("rejects a new notebook with %s", (_name, space) => {
    expect(notebookChoiceSchema.safeParse({ title: "A", space }).success).toBe(false);
  });

  it("rejects a space on an existing notebook", () => {
    expect(notebookChoiceSchema.safeParse({ existingId: "nb_1", space: { kind: "core" } }).success).toBe(false);
  });

  it.each([
    ["a location on a new notebook", { title: "A", location: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" } }],
    ["a location on an existing notebook", { existingId: "nb_1", location: { workspaceType: "Lab", workspaceId: null, parentPageId: null } }],
    ["links on a new notebook", { title: "A", links: [] }],
    ["links on an existing notebook", { existingId: "nb_1", links: [] }],
  ])("rejects %s", (_name, value) => {
    expect(notebookChoiceSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a blank name, an empty id, and neither shape", () => {
    expect(notebookChoiceSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(notebookChoiceSchema.safeParse({ existingId: "" }).success).toBe(false);
    expect(notebookChoiceSchema.safeParse({}).success).toBe(false);
    expect(notebookChoiceSchema.safeParse(null).success).toBe(false);
  });
});

describe("isExistingChoice", () => {
  it("tells the two shapes apart", () => {
    expect(isExistingChoice({ existingId: "nb_1" })).toBe(true);
    expect(isExistingChoice({ title: "New" })).toBe(false);
  });
});

describe("add-note schemas", () => {
  it("take the slim notebook choice and reject a location inside it", () => {
    const base = { intent: "add-meeting-note", meetingId: "m1" };
    expect(AddMeetingNoteSchema.safeParse({ ...base, notebook: { existingId: "nb_1" } }).success).toBe(true);
    expect(
      AddMeetingNoteSchema.safeParse({
        ...base,
        notebook: { existingId: "nb_1", location: { workspaceType: "Lab", workspaceId: null, parentPageId: null } },
      }).success,
    ).toBe(false);
  });

  it("no longer carry a noteLocation", () => {
    const parsed = AddMeetingWhiteboardSchema.parse({
      intent: "add-meeting-whiteboard",
      meetingId: "m1",
      noteLocation: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" },
    });
    expect(parsed).not.toHaveProperty("noteLocation");
  });
});
