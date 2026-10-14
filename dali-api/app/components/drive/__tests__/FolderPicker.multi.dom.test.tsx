// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  FolderPicker,
  type Destination,
  type MultiResult,
  type PickerDrive,
  type PickerFolder,
} from "~/components/drive/FolderPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const drives: PickerDrive[] = [{ id: "lab", label: "Lab" }];
const folders: PickerFolder[] = [
  { id: "ops", driveId: "lab", parentId: null, title: "Ops" },
  { id: "design", driveId: "lab", parentId: null, title: "Design" },
  { id: "notes", driveId: "lab", parentId: "ops", title: "Notes" },
];
const ops: Destination = { driveId: "lab", folderId: "ops" };
const design: Destination = { driveId: "lab", folderId: "design" };
const notes: Destination = { driveId: "lab", folderId: "notes" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  window.localStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type Extra = Partial<Extract<Parameters<typeof FolderPicker>[0], { mode: "multi" }>>;

function mountMulti(extra: Extra = {}) {
  const onConfirm = vi.fn<(r: MultiResult) => void>();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(FolderPicker, {
        open: true,
        onClose: () => {},
        heading: "File in",
        drives,
        folders,
        mode: "multi",
        onConfirm,
        ...extra,
      } as Parameters<typeof FolderPicker>[0]),
    ),
  );
  return { onConfirm };
}

const chips = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="picker-chip"]'));
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const confirmButton = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "File")!;
const footer = () => document.querySelector("p.truncate")!.textContent;

describe("FolderPicker multi mode", () => {
  it("draws a Meetings folder as a pink system folder with a calendar mark whether or not filing prefers it", () => {
    mountMulti({ initialDestinations: [], initial: { driveId: "lab", folderId: null }, folders: [...folders, { id: "mtg", driveId: "lab", parentId: null, title: "Meetings", folderType: "Meetings" }] });
    const rowOf = (title: string) => Array.from(document.querySelectorAll("li, [role=option], button")).find((e) => e.textContent?.trim() === title);
    const calendar = rowOf("Meetings")!.querySelector("svg.lucide-calendar-days");
    expect(calendar).not.toBeNull();
    expect(calendar!.getAttribute("class")).toContain("text-accent-pink");
    expect(rowOf("Meetings")!.querySelector("svg.lucide-folder-cog")).not.toBeNull();
    expect(rowOf("Ops")!.querySelector("svg.lucide-calendar-days")).toBeNull();
    expect(rowOf("Ops")!.querySelector("svg.lucide-folder-cog")).toBeNull();
  });

  it("opens with the given destinations as chips, the first one primary", () => {
    mountMulti({ initialDestinations: [ops, design] });
    expect(chips().map((c) => c.textContent)).toEqual([
      expect.stringContaining("Lab / Ops"),
      expect.stringContaining("Lab / Design"),
    ]);
    expect(chips()[0].textContent).toContain("Primary");
    expect(chips()[1].textContent).toContain("Make primary");
    expect(footer()).toBe("Primary: Lab / Ops");
  });

  it("makes another chip primary when its marker is clicked", () => {
    mountMulti({ initialDestinations: [ops, design] });
    click(button("Make Lab / Design primary"));
    expect(chips()[0].textContent).toContain("Make primary");
    expect(chips()[1].textContent).toContain("Primary");
    expect(footer()).toBe("Primary: Lab / Design");
  });

  it("promotes the next chip when the primary is removed", () => {
    mountMulti({ initialDestinations: [ops, design] });
    click(button("Remove Lab / Ops"));
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain("Primary");
    expect(footer()).toBe("Primary: Lab / Design");
  });

  it("confirms with every destination and the primary's index", async () => {
    const { onConfirm } = mountMulti({ initialDestinations: [ops, design, notes] });
    click(button("Make Lab / Ops / Notes primary"));
    await act(async () => confirmButton().click());
    expect(onConfirm).toHaveBeenCalledWith({ destinations: [ops, design, notes], primaryIndex: 2 });
  });

  it("cannot confirm with nothing chosen", () => {
    mountMulti({ initialDestinations: [] });
    expect(confirmButton().disabled).toBe(true);
    expect(footer()).toBe("Select one or more destinations");
  });

  it("words the put-it-here row for filing, not moving", () => {
    mountMulti({ initialDestinations: [], initial: ops });
    expect(document.body.textContent).toContain('File in "Ops"');
    expect(document.body.textContent).not.toContain("Move into");
  });

  it("uses the confirm label it is given", () => {
    mountMulti({ initialDestinations: [ops], confirmLabel: "Save locations" });
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Save locations")).toBe(true);
  });

  it("keeps a locked chip: no remove, no make primary, never promoted", () => {
    mountMulti({ initialDestinations: [ops, design, notes], lockedDestinations: [design] });
    expect(button("Remove Lab / Design")).toBeNull();
    expect(button("Make Lab / Design primary")).toBeNull();
    click(button("Remove Lab / Ops"));
    expect(chips()[1].textContent).toContain("Primary");
    expect(chips()[0].textContent).toContain("Shortcut");
  });

  it("toggles the active row with Space and not with typing in the search box", () => {
    mountMulti({ initialDestinations: [] });
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain("Lab");
    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(chips()).toHaveLength(0);

    const search = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(chips()).toHaveLength(0);
  });

  it("marks selected rows through their checkbox", () => {
    mountMulti({ initialDestinations: [], initial: { driveId: "lab", folderId: null } });
    const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('[role="option"] input[type="checkbox"]'));
    expect(boxes().length).toBeGreaterThan(1);
    click(boxes()[1]);
    expect(chips()).toHaveLength(1);
    expect(boxes()[1].checked).toBe(true);
    click(boxes()[1]);
    expect(chips()).toHaveLength(0);
  });
});

describe("FolderPicker single mode", () => {
  it("is unchanged: no chips, 'Move to' footer, confirm hands over one destination", async () => {
    const onConfirm = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(FolderPicker, {
          open: true,
          onClose: () => {},
          heading: "Move",
          drives,
          folders,
          initial: ops,
          onConfirm,
        }),
      ),
    );
    expect(chips()).toHaveLength(0);
    expect(footer()).toBe("Select a destination");
    expect(document.body.textContent).toContain('Move into "Ops"');
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    click(rows[0]);
    expect(footer()).toBe("Move to: Lab / Ops");
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    const move = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Move")!;
    await act(async () => move.click());
    expect(onConfirm).toHaveBeenCalledWith(ops);
  });

  function mountSingle(props: Record<string, unknown>) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(FolderPicker, {
          open: true,
          onClose: () => {},
          heading: "Add shortcut",
          drives,
          folders,
          onConfirm: () => {},
          ...props,
        } as Parameters<typeof FolderPicker>[0]),
      ),
    );
  }

  it("names the choice with the pending label it is given", () => {
    mountSingle({ initial: ops, pendingLabel: "Add to:" });
    click(document.querySelector('[role="option"]'));
    expect(footer()).toBe("Add to: Lab / Ops");
  });

  it("says its empty text when there is nothing to pick", () => {
    mountSingle({ drives: [], folders: [], emptyText: "There's nowhere to file this." });
    expect(document.body.textContent).toContain("There's nowhere to file this.");
  });
});

describe("FolderPicker: drive row icons", () => {
  const iconDrives: PickerDrive[] = [
    { id: "mine", label: "My Drive" },
    { id: "lab", label: "Lab" },
    { id: "core", label: "Core" },
    { id: "hiring", label: "Hiring" },
    { id: "mentorship", label: "Mentorship" },
    { id: "projects", label: "Projects" },
    { id: "education", label: "Education" },
    { id: "proj-1", label: "Atlas", iconEmoji: "🚀" },
    { id: "proj-2", label: "Plain" },
  ];

  it.each([
    ["My Drive", "lucide-user"],
    ["Lab", "lucide-users"],
    ["Core", "lucide-shield"],
    ["Hiring", "lucide-briefcase"],
    ["Mentorship", "lucide-heart"],
    ["Projects", "lucide-folder-kanban"],
    ["Education", "lucide-graduation-cap"],
    ["Plain", "lucide-folder"],
  ])("draws %s with %s", (label, iconClass) => {
    mountMulti({ drives: iconDrives, folders: [] });
    const row = Array.from(container.querySelectorAll('[role="option"]')).find((r) =>
      r.textContent?.startsWith(label),
    );
    const classes = row?.querySelector("svg")?.getAttribute("class")?.split(/\s+/) ?? [];
    expect(classes).toContain(iconClass);
  });

  it("draws a drive's emoji when it has no dedicated icon", () => {
    mountMulti({ drives: iconDrives, folders: [] });
    const row = Array.from(container.querySelectorAll('[role="option"]')).find((r) =>
      r.textContent?.includes("Atlas"),
    );
    expect(row?.textContent).toContain("🚀");
    expect(row?.querySelector("svg.lucide-folder")).toBeNull();
  });
});
