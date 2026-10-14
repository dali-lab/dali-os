// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import type { NotebookView } from "~/components/notebooks/NotebookRail";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import { EmptyNotebook } from "../documents.$pageId";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notebook: NotebookView = {
  id: "nb1",
  title: "Weekly sync",
  canEdit: true,
  canManage: true,
  workspaceType: "Lab",
  workspaceId: null,
  folderId: null,
  templateId: null,
  projectId: null,
  nextNote: { meetingId: "m1", occurrenceStart: "2026-10-20T14:00:00.000Z" },
  tabs: [],
};

let container: HTMLDivElement;
let root: Root;

async function mount() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(EmptyNotebook, { notebook }))),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("EmptyNotebook", () => {
  it("shows the rail with its Add menu and the empty state, with no editor", async () => {
    await mount();

    expect(container.querySelector('nav[aria-label="Weekly sync"]')).toBeTruthy();
    expect(container.textContent).toContain("No notes yet. Add one from the menu.");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Add")).toBe(true);
    expect(container.querySelector(".bn-editor, [contenteditable='true']")).toBeNull();
  });

  it("offers the next-meeting note and existing document in the Add menu", async () => {
    await mount();
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add")!;
    await act(async () => {
      add.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const items = [...document.body.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim());
    expect(items).toEqual(["Note for the next meeting", "Existing document…"]);
  });
});
