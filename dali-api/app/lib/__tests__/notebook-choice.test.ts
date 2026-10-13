import { describe, it, expect } from "vitest";
import { isExistingChoice, notebookChoiceSchema } from "~/lib/notebook-choice";

describe("notebookChoiceSchema", () => {
  it("accepts an existing notebook by id", () => {
    expect(notebookChoiceSchema.parse({ existingId: "nb_1" })).toEqual({ existingId: "nb_1" });
  });

  it("accepts a new notebook with only a name", () => {
    expect(notebookChoiceSchema.parse({ title: "  Standup " })).toEqual({ title: "Standup" });
  });

  it("accepts a new notebook with a Lab or Project location and a template", () => {
    const lab = { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" };
    const project = { workspaceType: "Project", workspaceId: "p1", parentPageId: null };
    expect(notebookChoiceSchema.safeParse({ title: "A", location: lab, templatePageId: "t" }).success).toBe(true);
    expect(notebookChoiceSchema.safeParse({ title: "A", location: project, templatePageId: null }).success).toBe(true);
    expect(notebookChoiceSchema.safeParse({ title: "A", location: null }).success).toBe(true);
  });

  it("rejects a Project location without a project and a Lab location with one", () => {
    expect(
      notebookChoiceSchema.safeParse({ title: "A", location: { workspaceType: "Project", workspaceId: null, parentPageId: null } })
        .success,
    ).toBe(false);
    expect(
      notebookChoiceSchema.safeParse({ title: "A", location: { workspaceType: "Lab", workspaceId: "p1", parentPageId: null } })
        .success,
    ).toBe(false);
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
