// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

// The epic description is a collab room; it needs a real browser + server.
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));

import { EpicDetail, type EditableEpic } from "../EpicSprintManager";
import { DialogProvider } from "~/components/ui/dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function epic(over: Partial<EditableEpic> = {}): EditableEpic {
  return {
    id: "epic-1",
    title: "Design",
    description: null,
    status: "InProgress",
    descriptionDocId: null,
    sprints: ["Sprint 3", "Sprint 4"],
    tasks: [
      { id: "task-1", title: "Wireframes", status: "InProgress", sprint: "Sprint 4" },
      { id: "task-2", title: "Copy", status: "Todo", sprint: null },
    ],
    stories: [
      {
        id: "story-1",
        title: "Onboarding",
        notes: null,
        status: "Todo",
        successMetric: null,
        acceptanceCriteria: null,
        category: null,
        priority: null,
      },
    ],
    ...over,
  };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

type DetailProps = ComponentProps<typeof EpicDetail>;

const baseProps: DetailProps = {
  projectId: "p1",
  epic: epic(),
  canManage: true,
  busy: false,
  run: (fn) => void fn(),
  api: async () => {},
  collabToken: null,
  userName: "Tester",
  onClose: () => {},
  onDeleted: () => {},
};

function mount(props: Partial<DetailProps>) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(DialogProvider, null, createElement(EpicDetail, { ...baseProps, ...props })),
    ),
  );
}

const buttonWithText = (text: string) =>
  [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;

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

describe("EpicDetail", () => {
  it("shows the derived status and the sprints its tasks sit in", () => {
    mount({});
    expect(container!.textContent).toContain("In progress");
    expect(container!.textContent).toContain("Sprint 3");
    expect(container!.textContent).toContain("Sprint 4");
  });

  it("prompts to sprint a task when the epic is unscheduled", () => {
    mount({ epic: epic({ sprints: [] }) });
    expect(container!.textContent).toContain("Put one of its tasks in a sprint");
  });

  it("lists tasks beside stories, with their sprint or Backlog, and opens one on click", () => {
    const onOpenTask = vi.fn();
    mount({ onOpenTask });
    expect(container!.textContent).toContain("Tasks (2)");
    expect(container!.textContent).toContain("Backlog");
    expect(container!.textContent).toContain("Onboarding");
    act(() => buttonWithText("Wireframes")!.click());
    expect(onOpenTask).toHaveBeenCalledWith("task-1");
  });

  it("adds a task to the epic for a manager with a handler", () => {
    const onAddTask = vi.fn();
    mount({ onAddTask });
    act(() => buttonWithText("Add task")!.click());
    expect(onAddTask).toHaveBeenCalledWith();
  });

  it("offers no add for viewers or without a handler (partner hub)", () => {
    mount({ canManage: false, onAddTask: () => {} });
    expect(buttonWithText("Add task")).toBeUndefined();
    act(() => root!.unmount());
    root = undefined;
    mount({});
    expect(buttonWithText("Add task")).toBeUndefined();
  });

  it("cancels and reopens the epic", () => {
    const api = vi.fn(async () => {});
    mount({ api });
    act(() => buttonWithText("Cancel epic")!.click());
    expect(api).toHaveBeenCalledWith("/api/epics/epic-1", "POST", { cancelled: true });
    act(() => root!.unmount());
    root = undefined;
    mount({ api, epic: epic({ status: "Cancelled" }) });
    act(() => buttonWithText("Reopen epic")!.click());
    expect(api).toHaveBeenLastCalledWith("/api/epics/epic-1", "POST", { cancelled: false });
  });
});
