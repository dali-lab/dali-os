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
