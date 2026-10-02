// @vitest-environment jsdom
//
// The epic modal has to close to make room for the task form (a modal on a
// modal buries the one underneath), which left you back on the timeline with
// the epic shut — cumbersome when a story needs more than one task. These pin
// the round trip: the modal reopens when the caller reports the form closed,
// and the add that closed it is the one that asks for it back.
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
      status: "Open",
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

type AddLink = { epicId: string; storyId: string; reopenEpicId?: string };

// Drives `reopenEpic` from real state, the way the project route does with
// what onCreateClosed hands it. The manager reaches for useNavigate and
// useRevalidator, so it also needs a router around it.
let setReopen: ((v: { epicId: string } | null) => void) | undefined;
let onAddTask: ((link?: AddLink) => void) | undefined;

const Stub = createRoutesStub([
  {
    path: "/",
    Component: function Harness() {
      const [reopenEpic, setState] = useState<{ epicId: string } | null>(null);
      setReopen = setState;
      return createElement(
        DialogProvider,
        null,
        createElement(EpicSprintManager, {
          projectId: "p1",
          epics: epics(),
          terms: [],
          canManage: true,
          collabToken: null,
          userName: "Tester",
          onAddTask,
          reopenEpic,
        }),
      );
    },
  },
]);

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Stub, { initialEntries: ["/"] })));
}

const epicModalOpen = () => container!.querySelector("#epic-detail-title") != null;

afterEach(() => {
  if (root) {
    const r = root;
    act(() => r.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
  setReopen = undefined;
  onAddTask = undefined;
  vi.unstubAllGlobals();
});

describe("EpicSprintManager epic reopen", () => {
  it("reopens the epic when the caller reports the form closed", () => {
    // The modal pings for a description room on a manager open.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    mount();
    expect(epicModalOpen()).toBe(false);

    act(() => setReopen!({ epicId: "epic-1" }));
    expect(epicModalOpen()).toBe(true);
  });

  it("stays shut when the add covered nothing up", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    mount();
    // The outline's own add and the Add menu name no epic to restore, so the
    // route hands back null and nothing should spring open.
    act(() => setReopen!(null));
    expect(epicModalOpen()).toBe(false);
  });

  it("closes on a story's add and asks for that epic back", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const add = vi.fn();
    onAddTask = add;
    mount();

    act(() => setReopen!({ epicId: "epic-1" }));
    const plus = container!.querySelector(
      '[aria-label="Add task to Onboarding"]',
    ) as HTMLElement;
    expect(plus).toBeTruthy();
    act(() => plus.click());

    // Out of the way for the form, carrying the way back.
    expect(epicModalOpen()).toBe(false);
    expect(add).toHaveBeenCalledWith({
      epicId: "epic-1",
      storyId: "story-1",
      reopenEpicId: "epic-1",
    });
  });

  it("reopens again after a second add, so repeat adds keep working", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    onAddTask = () => {};
    mount();

    for (const _pass of [1, 2]) {
      act(() => setReopen!({ epicId: "epic-1" }));
      expect(epicModalOpen()).toBe(true);
      const plus = container!.querySelector(
        '[aria-label="Add task to Onboarding"]',
      ) as HTMLElement;
      act(() => plus.click());
      expect(epicModalOpen()).toBe(false);
    }
  });
});
