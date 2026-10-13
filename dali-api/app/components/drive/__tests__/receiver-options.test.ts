import { describe, expect, it } from "vitest";
import {
  CHOICE_HINT,
  CHOICE_NONE,
  choiceLabel,
  currentChoice,
  eligibleSlotsFor,
  isPageFolder,
  planChoiceChange,
  projectIdFor,
  receiverPickerRows,
  receivesLabel,
  slotChoice,
  spaceNoun,
  topLevelOf,
} from "~/components/drive/receiver-options";
import type { PickerRows } from "~/components/drive/picker-rows";

const types = (slots: ReturnType<typeof eligibleSlotsFor>) => slots.map((s) => `${s.processType}:${s.folderType}`);

describe("eligibleSlotsFor", () => {
  it("offers Core's four slots in the Core space, to Core only", () => {
    expect(types(eligibleSlotsFor("core", null, true, false))).toEqual([
      "Core:Meetings",
      "Core:Agreements",
      "Core:EducationTemplates",
      "Core:CertificateBackgrounds",
    ]);
    expect(eligibleSlotsFor("core", null, false, true)).toEqual([]);
  });

  it("offers the Hiring slots in the Hiring space, to Core only", () => {
    expect(types(eligibleSlotsFor("hiring", null, true, false))).toEqual([
      "HiringCycle:HiringForms",
      "HiringCycle:ApplicationTemplates",
    ]);
    expect(eligibleSlotsFor("hiring", null, false, false)).toEqual([]);
  });

  it("offers Mentor notebooks in the Mentorship space, to Core only", () => {
    expect(types(eligibleSlotsFor("mentorship", null, true, false))).toEqual(["Mentorship:MentorNotebooks"]);
    expect(eligibleSlotsFor("mentorship", null, false, false)).toEqual([]);
  });

  it("offers the Lab Meetings receiver in General, to Core only", () => {
    expect(types(eligibleSlotsFor("lab", null, true, false))).toEqual(["Lab:Meetings"]);
    expect(eligibleSlotsFor("lab", null, false, true)).toEqual([]);
  });

  it("offers the project's Meetings to Core and to its members, named by project id", () => {
    const core = eligibleSlotsFor("projects", "p1", true, false);
    expect(core).toEqual([{ processType: "Project", processId: "p1", folderType: "Meetings" }]);
    expect(eligibleSlotsFor("project:p1", "p1", false, true)).toEqual(core);
    expect(eligibleSlotsFor("project:p1", "p1", false, false)).toEqual([]);
  });

  it("offers nothing in a project scope whose project is unknown", () => {
    expect(eligibleSlotsFor("projects", null, true, true)).toEqual([]);
  });

  it("offers nothing in My Drive or Education", () => {
    expect(eligibleSlotsFor("mine", null, true, true)).toEqual([]);
    expect(eligibleSlotsFor("education", null, true, true)).toEqual([]);
  });
});

describe("projectIdFor", () => {
  const items = [
    { id: "p1", parentFolderId: null },
    { id: "a", parentFolderId: "p1" },
    { id: "b", parentFolderId: "a" },
    { id: "p2", parentFolderId: null },
  ];

  it("reads the id off an embedded project scope", () => {
    expect(projectIdFor("project:p9", [], "x")).toBe("p9");
  });

  it("walks a Projects drive folder up to its synthetic project folder", () => {
    expect(projectIdFor("projects", items, "b")).toBe("p1");
    expect(projectIdFor("projects", items, "a")).toBe("p1");
  });

  it("has no project for the synthetic project folder itself or for other scopes", () => {
    expect(projectIdFor("projects", items, "p2")).toBeNull();
    expect(projectIdFor("core", items, "a")).toBeNull();
  });

  it("ends on a cyclic chain", () => {
    const loop = [
      { id: "a", parentFolderId: "b" },
      { id: "b", parentFolderId: "a" },
    ];
    expect(projectIdFor("projects", loop, "a")).toBeNull();
  });
});

describe("isPageFolder", () => {
  it("accepts a plain or typed page folder", () => {
    expect(isPageFolder({ type: "folder", href: "/documents/f1", folderType: null })).toBe(true);
    expect(isPageFolder({ type: "folder", href: "/documents/f1", folderType: "Agreements" })).toBe(true);
  });

  it("rejects roots, synthetic project and offering folders, and non-folders", () => {
    expect(isPageFolder({ type: "folder", href: "/documents/f1", folderType: "Root" })).toBe(false);
    expect(isPageFolder({ type: "folder", href: "/projects/p1" })).toBe(false);
    expect(isPageFolder({ type: "folder", href: "/education/o1" })).toBe(false);
    expect(isPageFolder({ type: "doc", href: "/documents/d1" })).toBe(false);
  });
});

describe("currentChoice", () => {
  const slots = eligibleSlotsFor("core", null, true, false);

  it("is the slot this folder holds", () => {
    expect(
      currentChoice({ folderId: "f1", folderType: "Agreements", slots, holders: { Agreements: "f1", Meetings: "f2" } }),
    ).toBe("slot:Core:Agreements");
  });

  it("prefers the slot over the hint for a Meetings folder that holds the receiver", () => {
    expect(currentChoice({ folderId: "f1", folderType: "Meetings", slots, holders: { Meetings: "f1" } })).toBe(
      "slot:Core:Meetings",
    );
  });

  it("is the hint for a Meetings folder that holds no slot", () => {
    expect(currentChoice({ folderId: "f1", folderType: "Meetings", slots, holders: { Meetings: "f2" } })).toBe(
      CHOICE_HINT,
    );
  });

  it("is none for a plain folder, or when no slot data loaded", () => {
    expect(currentChoice({ folderId: "f1", folderType: null, slots, holders: {} })).toBe(CHOICE_NONE);
    expect(currentChoice({ folderId: "f1", folderType: "Agreements", slots: [], holders: {} })).toBe(CHOICE_NONE);
  });
});

describe("planChoiceChange", () => {
  const slots = eligibleSlotsFor("core", null, true, false);
  const meetings = slotChoice(slots[0]);
  const agreements = slotChoice(slots[1]);

  it("does nothing when the choice is unchanged", () => {
    expect(planChoiceChange("f1", CHOICE_HINT, CHOICE_HINT, slots)).toEqual([]);
    expect(planChoiceChange("f1", CHOICE_NONE, CHOICE_NONE, slots)).toEqual([]);
  });

  it("sets a slot from none", () => {
    expect(planChoiceChange("f1", CHOICE_NONE, agreements, slots)).toEqual([
      { intent: "set", processType: "Core", folderType: "Agreements", folderId: "f1" },
    ]);
  });

  it("clears the old hint before setting a slot", () => {
    expect(planChoiceChange("f1", CHOICE_HINT, meetings, slots)).toEqual([
      { intent: "hint", folderId: "f1", hint: null },
      { intent: "set", processType: "Core", folderType: "Meetings", folderId: "f1" },
    ]);
  });

  it("clears the old slot before setting another or a hint", () => {
    expect(planChoiceChange("f1", meetings, agreements, slots)).toEqual([
      { intent: "clear", processType: "Core", folderType: "Meetings" },
      { intent: "set", processType: "Core", folderType: "Agreements", folderId: "f1" },
    ]);
    expect(planChoiceChange("f1", meetings, CHOICE_HINT, slots)).toEqual([
      { intent: "clear", processType: "Core", folderType: "Meetings" },
      { intent: "hint", folderId: "f1", hint: "Meetings" },
    ]);
  });

  it("clears a slot or a hint when None is chosen", () => {
    expect(planChoiceChange("f1", agreements, CHOICE_NONE, slots)).toEqual([
      { intent: "clear", processType: "Core", folderType: "Agreements" },
    ]);
    expect(planChoiceChange("f1", CHOICE_HINT, CHOICE_NONE, slots)).toEqual([
      { intent: "hint", folderId: "f1", hint: null },
    ]);
  });

  it("sends the project id for a project slot", () => {
    const project = eligibleSlotsFor("project:p1", "p1", false, true);
    expect(planChoiceChange("f1", CHOICE_NONE, slotChoice(project[0]), project)).toEqual([
      { intent: "set", processType: "Project", processId: "p1", folderType: "Meetings", folderId: "f1" },
    ]);
  });
});

describe("choiceLabel", () => {
  const slots = eligibleSlotsFor("core", null, true, false);

  it("names none, the hint and each slot", () => {
    expect(choiceLabel(CHOICE_NONE, slots)).toBe("None");
    expect(choiceLabel(CHOICE_HINT, slots)).toBe("Meeting notebooks (hint)");
    expect(choiceLabel(slotChoice(slots[0]), slots)).toBe("Meeting notebooks (new notes file here)");
    expect(choiceLabel(slotChoice(slots[1]), slots)).toBe("Agreements");
  });

  it("falls back to None for a slot that isn't offered", () => {
    expect(choiceLabel("slot:Core:Agreements", [])).toBe("None");
  });
});

describe("receiverPickerRows", () => {
  const rows: PickerRows = {
    drives: [
      { id: "core", label: "Core" },
      { id: "hiring", label: "Hiring" },
      { id: "lab", label: "Lab" },
      { id: "projects", label: "Projects" },
    ],
    folders: [
      { id: "c1", driveId: "core", parentId: null, title: "Templates" },
      { id: "h1", driveId: "hiring", parentId: null, title: "Forms" },
      { id: "l1", driveId: "lab", parentId: null, title: "Ops" },
      { id: "p1", driveId: "projects", parentId: null, title: "Atlas" },
      { id: "p1a", driveId: "projects", parentId: "p1", title: "Meetings" },
      { id: "p1b", driveId: "projects", parentId: "p1a", title: "Check-ins" },
      { id: "p2", driveId: "projects", parentId: null, title: "Borealis" },
      { id: "p2a", driveId: "projects", parentId: "p2", title: "Other" },
    ],
  };

  it("keeps only the drive the process files into", () => {
    expect(receiverPickerRows(rows, "Core", null).drives.map((d) => d.id)).toEqual(["core"]);
    expect(receiverPickerRows(rows, "HiringCycle", null).folders.map((f) => f.id)).toEqual(["h1"]);
    expect(receiverPickerRows(rows, "Lab", null).folders.map((f) => f.id)).toEqual(["l1"]);
    expect(receiverPickerRows(rows, "Mentorship", null)).toEqual({ drives: [], folders: [] });
  });

  it("offers a project's subtree as a drive named for the project, re-rooted", () => {
    const out = receiverPickerRows(rows, "Project", "p1");
    expect(out.drives).toEqual([{ id: "projects", label: "Atlas" }]);
    expect(out.folders.map((f) => [f.id, f.parentId])).toEqual([
      ["p1a", null],
      ["p1b", "p1a"],
    ]);
  });

  it("offers nothing for a project the viewer can't see", () => {
    expect(receiverPickerRows(rows, "Project", "nope")).toEqual({ drives: [], folders: [] });
  });
});

describe("topLevelOf", () => {
  it("is the first drive's top level, which can't be a receiver", () => {
    expect(topLevelOf({ drives: [{ id: "core", label: "Core" }], folders: [] })).toEqual({
      driveId: "core",
      folderId: null,
    });
    expect(topLevelOf({ drives: [], folders: [] })).toBeNull();
  });
});

describe("receivesLabel and spaceNoun", () => {
  it("labels receiver types and nothing else", () => {
    expect(receivesLabel("HiringForms")).toBe("Hiring forms");
    expect(receivesLabel("Meetings")).toBe("Meeting notebooks");
    expect(receivesLabel("Root")).toBeNull();
    expect(receivesLabel(null)).toBeNull();
    expect(receivesLabel(undefined)).toBeNull();
    expect(receivesLabel("toString")).toBeNull();
  });

  it("names each process's space", () => {
    expect(spaceNoun("Core")).toBe("Core");
    expect(spaceNoun("HiringCycle")).toBe("Hiring");
    expect(spaceNoun("Mentorship")).toBe("Mentorship");
    expect(spaceNoun("Lab")).toBe("General");
    expect(spaceNoun("Project")).toBe("project");
  });
});
