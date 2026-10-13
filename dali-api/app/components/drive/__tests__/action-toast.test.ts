import { describe, expect, it } from "vitest";
import {
  ACTION_TOAST_MS,
  SHORTCUT_REMOVED_TOAST,
  destinationLabel,
  filedToast,
  movedToast,
  pathLabel,
  quoted,
  restoredToast,
  shortcutToast,
  trashedToast,
} from "~/components/drive/action-toast";

describe("quoted", () => {
  it("wraps a title in typographic quotes", () => {
    expect(quoted("Weekly sync")).toBe("“Weekly sync”");
  });

  it("calls an empty or blank title Untitled", () => {
    expect(quoted("")).toBe("“Untitled”");
    expect(quoted("   ")).toBe("“Untitled”");
    expect(quoted(null)).toBe("“Untitled”");
    expect(quoted(undefined)).toBe("“Untitled”");
  });
});

describe("pathLabel", () => {
  it("joins with the arrow and skips empty parts", () => {
    expect(pathLabel(["Core", "Meetings"])).toBe("Core ▸ Meetings");
    expect(pathLabel(["Core", "", "Weekly"])).toBe("Core ▸ Weekly");
    expect(pathLabel(["Core"])).toBe("Core");
  });
});

describe("movedToast", () => {
  it("names one item and where it went", () => {
    expect(movedToast({ titles: ["Weekly sync"], destination: "Core ▸ Meetings" })).toBe(
      "Moved “Weekly sync” to Core ▸ Meetings",
    );
  });

  it("counts several items", () => {
    expect(movedToast({ titles: ["a", "b", "c", "d"], destination: "Core ▸ Meetings" })).toBe(
      "Moved 4 items to Core ▸ Meetings",
    );
  });

  it("says how many of the attempted items landed", () => {
    expect(movedToast({ titles: ["a", "b", "c"], attempted: 4, destination: "Core ▸ Meetings" })).toBe(
      "Moved 3 of 4 items to Core ▸ Meetings",
    );
    expect(movedToast({ titles: ["a"], attempted: 2, destination: "Core" })).toBe("Moved 1 of 2 items to Core");
  });

  it("leaves the destination off when it is unknown", () => {
    expect(movedToast({ titles: ["X"] })).toBe("Moved “X”");
    expect(movedToast({ titles: ["X"], destination: null })).toBe("Moved “X”");
    expect(movedToast({ titles: ["a", "b", "c", "d"], destination: "" })).toBe("Moved 4 items");
    expect(movedToast({ titles: ["a", "b"], attempted: 3 })).toBe("Moved 2 of 3 items");
  });

  it("titles an untitled item", () => {
    expect(movedToast({ titles: [""], destination: "Lab" })).toBe("Moved “Untitled” to Lab");
  });
});

describe("filedToast", () => {
  const base = { title: "Kickoff", destination: "Core ▸ Meetings" };

  it("names the item and its primary location", () => {
    expect(filedToast(base)).toBe("Filed “Kickoff” in Core ▸ Meetings");
  });

  it("lists up to two shortcut locations", () => {
    expect(filedToast({ ...base, shortcutDestinations: ["Project Y"] })).toBe(
      "Filed “Kickoff” in Core ▸ Meetings, also in Project Y",
    );
    expect(filedToast({ ...base, shortcutDestinations: ["Project Y", "Lab"] })).toBe(
      "Filed “Kickoff” in Core ▸ Meetings, also in Project Y and Lab",
    );
  });

  it("counts the rest after two", () => {
    expect(filedToast({ ...base, shortcutDestinations: ["A", "B", "C"] })).toBe(
      "Filed “Kickoff” in Core ▸ Meetings, also in A, B and 1 more",
    );
    expect(filedToast({ ...base, shortcutDestinations: ["A", "B", "C", "D"] })).toBe(
      "Filed “Kickoff” in Core ▸ Meetings, also in A, B and 2 more",
    );
  });

  it("appends the declined grants as its own sentence", () => {
    expect(filedToast({ ...base, declined: 1 })).toBe(
      "Filed “Kickoff” in Core ▸ Meetings. 1 could not be shared; ask the owner.",
    );
    expect(filedToast({ ...base, shortcutDestinations: ["A"], declined: 2 })).toBe(
      "Filed “Kickoff” in Core ▸ Meetings, also in A. 2 could not be shared; ask the owner.",
    );
  });

  it("says nothing about grants when none were declined", () => {
    expect(filedToast({ ...base, declined: 0 })).not.toContain("could not be shared");
  });
});

describe("shortcutToast", () => {
  const base = { title: "Kickoff", destination: "Core ▸ Meetings" };

  it("names the item and the folder the shortcut is in", () => {
    expect(shortcutToast({ ...base, created: true })).toBe("Added a shortcut to “Kickoff” in Core ▸ Meetings");
  });

  it("says when the grant was declined", () => {
    expect(shortcutToast({ ...base, created: true, grantDeclined: true })).toBe(
      "Added a shortcut to “Kickoff” in Core ▸ Meetings. It could not be shared; ask the owner.",
    );
  });

  it("says there is already a shortcut there", () => {
    expect(shortcutToast({ ...base, created: false })).toBe("There is already a shortcut in Core ▸ Meetings.");
  });
});

describe("trashedToast", () => {
  it("names one item", () => {
    expect(trashedToast([{ type: "doc", title: "Notes" }])).toBe("Moved “Notes” to Trash");
  });

  it("counts several", () => {
    expect(
      trashedToast([
        { type: "doc", title: "a" },
        { type: "file", title: "b" },
        { type: "form", title: "c" },
        { type: "folder", title: "d" },
      ]),
    ).toBe("Moved 4 items to Trash");
  });

  it("says the originals are untouched when only shortcuts went", () => {
    expect(trashedToast([{ type: "shortcut", title: "s" }])).toBe(SHORTCUT_REMOVED_TOAST);
    expect(
      trashedToast([
        { type: "shortcut", title: "s" },
        { type: "shortcut", title: "t" },
      ]),
    ).toBe("2 shortcuts removed. The originals are untouched.");
  });

  it("counts a mixed selection as items moved to Trash", () => {
    expect(
      trashedToast([
        { type: "shortcut", title: "s" },
        { type: "doc", title: "d" },
      ]),
    ).toBe("Moved 2 items to Trash");
  });

  it("keeps the shortcut sentence exact", () => {
    expect(SHORTCUT_REMOVED_TOAST).toBe("Shortcut removed. The original is untouched.");
  });
});

describe("restoredToast", () => {
  it("names one item or counts several", () => {
    expect(restoredToast(["Notes"])).toBe("Restored “Notes”");
    expect(restoredToast(["a", "b", "c", "d"])).toBe("Restored 4 items");
  });
});

describe("destinationLabel", () => {
  const scope = {
    label: "Core",
    rootFolderId: "core-root",
    items: [
      { id: "meetings", title: "Meetings", parentFolderId: "core-root" },
      { id: "weekly", title: "Weekly", parentFolderId: "meetings" },
      { id: "blank", title: "", parentFolderId: "core-root" },
    ],
  };

  it("names the drive alone for its top level", () => {
    expect(destinationLabel(scope, null)).toBe("Core");
    expect(destinationLabel(scope, "core-root")).toBe("Core");
  });

  it("walks the folder chain up to the drive root", () => {
    expect(destinationLabel(scope, "meetings")).toBe("Core ▸ Meetings");
    expect(destinationLabel(scope, "weekly")).toBe("Core ▸ Meetings ▸ Weekly");
  });

  it("titles an unnamed folder", () => {
    expect(destinationLabel(scope, "blank")).toBe("Core ▸ Untitled folder");
  });

  it("stops at a folder it can't find", () => {
    expect(destinationLabel(scope, "gone")).toBe("Core");
  });

  it("does not loop on a cycle", () => {
    const loop = {
      label: "Lab",
      items: [
        { id: "a", title: "A", parentFolderId: "b" },
        { id: "b", title: "B", parentFolderId: "a" },
      ],
    };
    expect(destinationLabel(loop, "a")).toBe("Lab ▸ B ▸ A");
  });

  it("works for a scope with no root folder", () => {
    const lab = { label: "Lab", items: [{ id: "f", title: "Ops", parentFolderId: null }] };
    expect(destinationLabel(lab, "f")).toBe("Lab ▸ Ops");
  });
});

describe("ACTION_TOAST_MS", () => {
  it("is long enough to reach for Undo", () => {
    expect(ACTION_TOAST_MS).toBe(8000);
  });
});
