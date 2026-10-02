// @vitest-environment jsdom
//
// Guards the per-story "Add task" affordance in the epic detail modal — the
// other half of the story-scoped shortcut (see EpicList.addtask.test.tsx).
// Three things have to hold: it appears only when a task can actually be
// created (an onAddTask handler — the partner hub mounts this modal read-only
// and passes none), it names its own story, and clicking it hands that story
// back so the task form can open already filed under it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

// The epic description is a collab room; it needs a real browser + server.
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));

import { EpicDetail, type EditableEpic } from "../EpicSprintManager";
import { DialogProvider } from "~/components/ui/dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function epic(): EditableEpic {
  return {
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
  };
}

const ADD_LABEL = "Add task to Onboarding";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

type DetailProps = ComponentProps<typeof EpicDetail>;

const baseProps: DetailProps = {
  projectId: "p1",
  epic: epic(),
  storyOptions: [],
  epicOptions: [],
  timelineTerms: [],
  canManage: true,
  busy: false,
  run: () => {},
  api: async () => {},
  collabToken: null,
  userName: "Tester",
  onClose: () => {},
  onDeleted: () => {},
};

function mount(props: Partial<DetailProps>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(
        DialogProvider,
        null,
        createElement(EpicDetail, { ...baseProps, ...props }),
      ),
    ),
  );
}

afterEach(() => {
  if (root) {
    const r = root;
    act(() => r.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
});

describe("EpicDetail add-task affordance", () => {
  it("renders a per-story add button for a manager with a handler", () => {
    // The modal pings for a description room on a manager open; it's irrelevant
    // here and wrapped in its own try/catch, but stub it so nothing warns.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    mount({ onAddTask: () => {} });
    expect(container!.querySelector(`[aria-label="${ADD_LABEL}"]`)).toBeTruthy();
  });

  it("renders nothing without a handler (partner hub)", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    // The partner hub mounts this with canManage false and no handler at all.
    mount({ canManage: false });
    expect(container!.querySelector(`[aria-label="${ADD_LABEL}"]`)).toBeNull();
    expect(container!.textContent).not.toContain("Add task");
  });

  it("renders nothing for a viewer even when a handler is passed", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    mount({ canManage: false, onAddTask: () => {} });
    expect(container!.querySelector(`[aria-label="${ADD_LABEL}"]`)).toBeNull();
  });

  it("clicking the add hands back the story it sits on", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const onAddTask = vi.fn();
    mount({ onAddTask });
    const button = container!.querySelector(
      `[aria-label="${ADD_LABEL}"]`,
    ) as HTMLElement;
    act(() => button.click());
    // Just the story — the caller knows which epic's modal is open.
    expect(onAddTask).toHaveBeenCalledWith("story-1");
  });
});
