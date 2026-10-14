// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FiledInChips } from "~/calendar/components/FiledInChips";
import type { FilingPlace } from "~/calendar/components/meeting-note";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const place = (id: string, path: string): FilingPlace => ({
  dest: { driveId: "lab", folderId: id },
  location: { workspaceType: "Lab", workspaceId: null, parentPageId: id, label: path },
  path,
});
const ops = place("ops", "Lab / Ops");
const design = place("design", "Lab / Design");
const core = place("core", "Core / Meetings");

let container: HTMLDivElement;
let root: Root;

function mount(props: Partial<Parameters<typeof FiledInChips>[0]> = {}) {
  const handlers = {
    onPickSuggestion: vi.fn(),
    onMakeLocation: vi.fn(),
    onReorder: vi.fn(),
    onRemove: vi.fn(),
    onAdd: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(FiledInChips, {
        places: [ops, design, core],
        suggestions: [],
        labelClass: "",
        ...handlers,
        ...props,
      }),
    ),
  );
  return handlers;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const chips = (selector = "") => Array.from(container.querySelectorAll(`${selector} [data-testid='filed-in-chip']`));
const names = (selector = "") => chips(selector).map((c) => c.textContent);
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const button = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
const labels = () => Array.from(container.querySelectorAll("span.lbl")).map((l) => l.textContent);

describe("FiledInChips", () => {
  it("shows the first place under Location and the rest under Shortcuts", () => {
    mount({ labelClass: "lbl" });
    expect(labels()).toEqual(["Location", "Shortcuts"]);
    expect(names("ul[aria-label='Location']")).toEqual(["Lab / Ops"]);
    expect(names("ul[aria-label='Shortcuts']")).toEqual(["Lab / Design", "Core / Meetings"]);
  });

  it("shows no Primary or Link badges", () => {
    mount();
    expect(container.textContent).not.toContain("Primary");
    expect(container.textContent).not.toContain("Link");
  });

  it("gives every row a drag handle named for its place", () => {
    mount();
    const handles = Array.from(container.querySelectorAll("button[aria-label^='Reorder ']"));
    expect(handles.map((h) => h.getAttribute("aria-label"))).toEqual([
      "Reorder Lab / Ops",
      "Reorder Lab / Design",
      "Reorder Core / Meetings",
    ]);
    expect(handles.every((h) => h.getAttribute("aria-roledescription") === "sortable")).toBe(true);
  });

  it("offers Make location on shortcuts only", () => {
    const { onMakeLocation } = mount();
    const rows = chips();
    expect(rows[0]!.querySelector("button[aria-label='Make location']")).toBeNull();
    expect(rows[1]!.querySelector("button[aria-label='Make location']")).toBeTruthy();
    click(rows[2]!.querySelector("button[aria-label='Make location']"));
    expect(onMakeLocation).toHaveBeenCalledWith(core);
  });

  it("removes a row with its X, location or shortcut", () => {
    const { onRemove } = mount();
    click(container.querySelector("button[aria-label='Remove Core / Meetings']"));
    expect(onRemove).toHaveBeenLastCalledWith(core);
    click(container.querySelector("button[aria-label='Remove Lab / Ops']"));
    expect(onRemove).toHaveBeenLastCalledWith(ops);
  });

  it("can't remove the top row when it is locked to the notebook's own place", () => {
    mount({ lockTop: true });
    expect(container.querySelector("button[aria-label='Remove Lab / Ops']")).toBeNull();
    expect(container.querySelector("button[aria-label='Remove Lab / Design']")).toBeTruthy();
  });

  it("shows a fixed location with no handle and treats every place as a shortcut", () => {
    mount({ fixedLocation: "Projects / Atlas / Notes", places: [ops, design], labelClass: "lbl" });
    expect(names("ul[aria-label='Location']")).toEqual(["Projects / Atlas / Notes"]);
    expect(names("ul[aria-label='Shortcuts']")).toEqual(["Lab / Ops", "Lab / Design"]);
    expect(container.querySelector("ul[aria-label='Location'] button")).toBeNull();
    expect(container.querySelector("button[aria-label='Make location']")).toBeNull();
  });

  it("says the location comes from the notebook once one is chosen, with every place a shortcut", () => {
    mount({ fixedLocation: null, places: [ops] });
    expect(container.querySelector("ul[aria-label='Location']")).toBeNull();
    expect(container.textContent).toContain("Starts where the notebook you choose already lives.");
    expect(names("ul[aria-label='Shortcuts']")).toEqual(["Lab / Ops"]);
    expect(container.querySelector("button[aria-label='Make location']")).toBeNull();
  });

  it("opens the picker from Add a place", () => {
    const { onAdd } = mount();
    click(button("Add a place") ?? null);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("explains an empty location and empty shortcuts", () => {
    mount({ places: [] });
    expect(container.textContent).toContain("Goes in the default Meetings folder.");
    expect(container.textContent).toContain("No shortcuts. Add places where this notebook should also appear.");
  });

  it("explains empty shortcuts when only the location is set", () => {
    mount({ places: [ops] });
    expect(container.textContent).not.toContain("default Meetings folder");
    expect(container.textContent).toContain("No shortcuts.");
  });

  it("renders suggestion chips and reports which one was picked", () => {
    const { onPickSuggestion } = mount({
      places: [],
      suggestions: [
        { groupId: "g1", label: "Atlas", reason: "3 of 4 attendees" },
        { groupId: "g2", label: "Core", reason: "named in the title" },
      ],
    });
    const list = container.querySelector("ul[aria-label='Suggested places']")!;
    expect(Array.from(list.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Suggested: Atlas · 3 of 4 attendees",
      "Suggested: Core · named in the title",
    ]);
    click(list.querySelectorAll("button")[1]!);
    expect(onPickSuggestion).toHaveBeenCalledWith("g2");
  });

  it("renders no suggestion list when there are none", () => {
    mount();
    expect(container.querySelector("ul[aria-label='Suggested places']")).toBeNull();
  });

  it("warns when there are more shortcuts than the server accepts", () => {
    const many = Array.from({ length: 11 }, (_, i) => place(`f${i}`, `Lab / F${i}`));
    mount({ places: many });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("up to 8 shortcuts. Remove 2.");
  });

  it("counts every place as a shortcut under a fixed location when warning", () => {
    const many = Array.from({ length: 9 }, (_, i) => place(`f${i}`, `Lab / F${i}`));
    mount({ places: many, fixedLocation: "Projects / Atlas" });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("Remove 1.");
  });
});

describe("FiledInChips for a whiteboard with no note", () => {
  it("shows one location with no handle, no shortcuts section and no ranking", () => {
    mount({ boardOnly: true, places: [ops], labelClass: "lbl" });
    expect(labels()).toEqual(["Location"]);
    expect(names()).toEqual(["Lab / Ops"]);
    expect(container.querySelector("button[aria-label^='Reorder']")).toBeNull();
    expect(container.querySelector("button[aria-label='Make location']")).toBeNull();
    expect(container.textContent).not.toContain("Shortcuts");
  });

  it("removes the place and offers Change place", () => {
    const { onRemove } = mount({ boardOnly: true, places: [ops] });
    click(container.querySelector("button[aria-label='Remove Lab / Ops']"));
    expect(onRemove).toHaveBeenCalledWith(ops);
    expect(button("Change place")).toBeTruthy();
  });

  it("explains the default folder when nothing is chosen", () => {
    mount({ boardOnly: true, places: [] });
    expect(container.textContent).toContain("Goes in the default Meeting assets folder.");
    expect(button("Add a place")).toBeTruthy();
  });
});
