import { describe, expect, it } from "vitest";
import {
  ACTION_TOAST_MS,
  destinationLabel,
  movedToast,
  pathLabel,
  quoted,
  restoredToast,
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

describe("trashedToast", () => {
  it("names one item", () => {
    expect(trashedToast([{ title: "Notes" }])).toBe("Moved “Notes” to Trash");
  });

  it("counts several", () => {
    expect(trashedToast([{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }])).toBe("Moved 4 items to Trash");
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
