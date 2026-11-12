// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { StageActions, type StageActionsApplication } from "../StageActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(application: StageActionsApplication) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          DialogProvider,
          null,
          createElement(StageActions, { application, canEdit: true, onOpenSchedule: () => {}, onChanged: () => {} }),
        ),
      ),
    ),
  );
}

const button = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === text);

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("StageActions promotion wording", () => {
  it("offers to reopen the project for an accepted return", async () => {
    await mount({
      id: "a1",
      stage: "Accepted",
      resultingProjectId: null,
      continuesProject: { id: "old", name: "Research Computing Dashboard" },
    });
    expect(button("Create project")).toBeUndefined();
    await act(async () => button("Reopen project")!.click());
    expect(document.body.textContent).toContain("Reopen Research Computing Dashboard?");
  });

  it("still creates a project for a fresh accepted application", async () => {
    await mount({ id: "a2", stage: "Accepted", resultingProjectId: null, continuesProject: null });
    expect(button("Reopen project")).toBeUndefined();
    await act(async () => button("Create project")!.click());
    expect(document.body.textContent).toContain("Create a project from this application?");
  });
});
