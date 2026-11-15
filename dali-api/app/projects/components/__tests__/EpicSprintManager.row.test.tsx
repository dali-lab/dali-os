// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { Plus } from "lucide-react";

vi.mock("~/components/doc", () => ({ DocEditor: () => null }));

import { EpicSprintManager } from "../EpicSprintManager";
import { PageRowControlsScope, PageTabRow } from "~/components/os-page";
import { DialogProvider } from "~/components/ui/dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function mount(inRow: boolean, canManage = true) {
  const onAddTask = vi.fn();
  const manager = createElement(EpicSprintManager, {
    projectId: "p1",
    epics: [],
    terms: [],
    canManage,
    collabToken: null,
    userName: "Tester",
    onAddTask,
  });
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => {
        const body: ReactNode = inRow
          ? createElement(
              PageRowControlsScope,
              null,
              createElement(PageTabRow, { label: "Sections", tabs: [{ label: "Progress", icon: Plus, active: true, onClick: () => {} }] }),
              manager,
            )
          : manager;
        return createElement(DialogProvider, null, body);
      },
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Stub, { initialEntries: ["/"] })));
  return onAddTask;
}

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  root = undefined;
  container?.remove();
  document.body.innerHTML = "";
});

const rowButtons = () =>
  [...container!.querySelectorAll<HTMLElement>("[data-density] button")].map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
const bodyButtons = () =>
  [...container!.querySelectorAll<HTMLElement>("button")]
    .filter((b) => !b.closest("[data-density]"))
    .map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));

describe("EpicSprintManager controls", () => {
  it("puts Edit, Fullscreen, the view toggle and New in the page row, in that order, and out of the timeline header", () => {
    mount(true);
    const labels = rowButtons();
    expect(labels.slice(1, 6)).toEqual(["Edit", "Fullscreen", "Timeline view", "List view", "New"]);
    expect(bodyButtons()).not.toContain("Edit");
    expect(bodyButtons()).not.toContain("Fullscreen");
    expect(bodyButtons()).not.toContain("Timeline view");
  });

  it("toggles Edit from the row", () => {
    mount(true);
    const edit = () => [...container!.querySelectorAll<HTMLElement>("[data-density] button")].find((b) => /Edit|Done/.test(b.textContent ?? ""))!;
    expect(edit().getAttribute("aria-pressed")).toBe("false");
    act(() => edit().click());
    expect(edit().textContent).toContain("Done");
    expect(edit().getAttribute("aria-pressed")).toBe("true");
  });

  it("drops Edit and Fullscreen in the list view, which has neither", () => {
    mount(true);
    act(() => container!.querySelector<HTMLElement>('[aria-label="List view"]')!.click());
    const labels = rowButtons();
    expect(labels).not.toContain("Edit");
    expect(labels).not.toContain("Fullscreen");
    expect(labels).toContain("New");
  });

  it("offers no New or Edit without manage rights", () => {
    mount(true, false);
    const labels = rowButtons();
    expect(labels).not.toContain("New");
    expect(labels).not.toContain("Edit");
    expect(labels).toContain("Fullscreen");
  });

  it("opens New with Task, User story, Epic and Meeting, and Task adds a task", () => {
    const onAddTask = mount(true);
    act(() => [...container!.querySelectorAll<HTMLElement>("[data-density] button")].find((b) => b.textContent?.trim() === "New")!.click());
    const items = [...document.querySelectorAll('[role^="menuitem"]')].map((e) => e.textContent?.trim());
    expect(items).toEqual(["Task", "User story", "Epic", "Meeting"]);
    act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) => e.textContent === "Task")!.click());
    expect(onAddTask).toHaveBeenCalledOnce();
  });

  it("keeps the toolbar in the timeline header without a page row", () => {
    mount(false);
    expect(bodyButtons()).toEqual(expect.arrayContaining(["Edit", "Fullscreen", "Timeline view", "List view", "New"]));
  });
});
