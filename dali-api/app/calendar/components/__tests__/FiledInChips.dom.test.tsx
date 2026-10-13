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
    onMakePrimary: vi.fn(),
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
        existingNotebook: false,
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

const chips = () => Array.from(container.querySelectorAll("[data-testid='filed-in-chip']"));
const click = (el: Element | null) => act(() => (el as HTMLElement).click());

describe("FiledInChips", () => {
  it("shows each path, the first as Primary and the rest as Link", () => {
    mount();
    expect(chips().map((c) => c.textContent)).toEqual([
      "Lab / OpsPrimary",
      "Lab / DesignLink",
      "Core / MeetingsLink",
    ]);
  });

  it("makes a chip primary when its Link badge is clicked", () => {
    const { onMakePrimary } = mount();
    click(container.querySelector("button[aria-label='Make Lab / Design primary']"));
    expect(onMakePrimary).toHaveBeenCalledWith(design);
  });

  it("gives the primary no make-primary button", () => {
    mount();
    expect(container.querySelector("button[aria-label='Make Lab / Ops primary']")).toBeNull();
  });

  it("removes a chip with its X", () => {
    const { onRemove } = mount();
    click(container.querySelector("button[aria-label='Remove Core / Meetings']"));
    expect(onRemove).toHaveBeenCalledWith(core);
  });

  it("can remove the primary too", () => {
    const { onRemove } = mount();
    click(container.querySelector("button[aria-label='Remove Lab / Ops']"));
    expect(onRemove).toHaveBeenCalledWith(ops);
  });

  it("opens the picker from Add a place", () => {
    const { onAdd } = mount();
    const add = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Add a place"));
    click(add ?? null);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("labels every chip a plain Link for an existing notebook, with nothing to promote", () => {
    mount({ existingNotebook: true, places: [ops, design] });
    expect(chips().map((c) => c.textContent)).toEqual(["Lab / OpsLink", "Lab / DesignLink"]);
    expect(container.querySelector("button[aria-label^='Make']")).toBeNull();
  });

  it("explains an empty list for each notebook kind", () => {
    mount({ places: [] });
    expect(container.textContent).toContain("A new notebook goes in the default Meetings folder");
    act(() => root.unmount());
    container.remove();
    mount({ places: [], existingNotebook: true });
    expect(container.textContent).toContain("Add places to link this notebook from");
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

  it("warns when there are more links than the server accepts", () => {
    const many = Array.from({ length: 11 }, (_, i) => place(`f${i}`, `Lab / F${i}`));
    mount({ places: many });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("up to 8 links. Remove 2.");
  });

  it("counts every place as a link for an existing notebook when warning", () => {
    const many = Array.from({ length: 9 }, (_, i) => place(`f${i}`, `Lab / F${i}`));
    mount({ places: many, existingNotebook: true });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("Remove 1.");
  });
});
