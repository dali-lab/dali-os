// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

// The epic description is a collab room; it needs a real browser + server.
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));

import { EpicSprintManager, type EditableEpic } from "../EpicSprintManager";
import { DialogProvider } from "~/components/ui/dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

function epics(): EditableEpic[] {
  return [
    {
      id: "epic-1",
      title: "Design",
      description: null,
      status: "InProgress",
      startsAt: null,
      endsAt: null,
      descriptionDocId: null,
      dependsOn: [],
      stories: [
        {
          id: "story-1",
          title: "Onboarding",
          notes: null,
          status: "Todo",
          startsAt: null,
          endsAt: null,
          dependsOn: [],
          successMetric: null,
          acceptanceCriteria: null,
          category: null,
          priority: null,
        },
      ],
    },
  ];
}


const Stub = createRoutesStub([
  {
    path: "/",
    Component: () =>
      createElement(
        DialogProvider,
        null,
        createElement(EpicSprintManager, {
          projectId: "p1",
          epics: epics(),
          terms: [],
          canManage: true,
          collabToken: null,
          userName: "Tester",
          reopenEpic: { epicId: "epic-1" },
        }),
      ),
  },
]);

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  if (root) {
    const r = root;
    act(() => r.unmount());
    root = undefined;
  }
  container?.remove();
  vi.unstubAllGlobals();
});

describe("epic and story status selects", () => {
  it("show display labels, not enum values", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(Stub, { initialEntries: ["/"] })));
    const text = document.body.textContent ?? "";
    expect(text).toContain("In progress");
    expect(text).not.toMatch(/InProgress/);
  });
});
