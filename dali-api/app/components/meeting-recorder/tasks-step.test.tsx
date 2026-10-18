// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement, act } from "react";
import { MemoryRouter } from "react-router";
import { ActionItemDraftProvider, SUCCESS_VISIBLE_MS } from "./action-item-draft";
import { ActionItemChips } from "./ActionItemChips";
import { EnhanceBar } from "./EnhanceBar";
import { makeRec, mountDom } from "./test-support";
import type { EnhanceActionItem } from "./enhance-plan";
import type { UseMeetingRecording } from "./use-meeting-recording";

let editorRoot: HTMLElement;

const BLOCKS = [
  { id: "b1", type: "checkListItem", text: "Add two reviewers to the 26W cycle" },
  { id: "b2", type: "checkListItem", text: "Send the catering quote" },
  { id: "b3", type: "paragraph", text: "Unrelated paragraph" },
];

function buildEditor() {
  editorRoot = document.createElement("div");
  editorRoot.innerHTML = BLOCKS.map(
    (b) => `<div class="bn-block-outer" data-id="${b.id}"><div class="bn-block"><div class="bn-block-content"><p>${b.text}</p></div></div></div>`,
  ).join("");
  document.body.appendChild(editorRoot);
}

const ITEMS: EnhanceActionItem[] = [
  { text: "Add two reviewers to the 26W cycle", ownerName: "Maya Chen", ownerUserId: "u-maya", due: "2026-10-23" },
  { text: "Send the catering quote", ownerName: "Jordan", ownerUserId: null, due: null },
];

function recWith(items: EnhanceActionItem[] = ITEMS, extra: Partial<UseMeetingRecording> = {}) {
  return makeRec({
    phase: "done",
    enhancedAt: "2026-10-18T12:00:00Z",
    canCreateTasks: true,
    projectId: "p1",
    roster: [
      { userId: "u-maya", name: "Maya Chen" },
      { userId: "u-jordan", name: "Jordan Lee" },
    ],
    getNoteState: () => ({ blocks: BLOCKS, bodyText: "" }),
    enhanceNotes: {
      plan: { blocks: [], actionItems: items },
      verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
      snapshotAt: "snap-1",
      snapshot: [],
    },
    ...extra,
  });
}

function mount(rec: UseMeetingRecording) {
  buildEditor();
  return mountDom(
    createElement(
      MemoryRouter,
      null,
      createElement(
        ActionItemDraftProvider,
        { rec, children: [createElement(EnhanceBar, { rec, key: "bar" }), createElement(ActionItemChips, { rec, getRoot: () => editorRoot, key: "chips" })] },
      ),
    ),
  );
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

const bar = () => document.querySelector('[role="region"]');
const chipsFor = (i: number) => document.querySelector(`[data-action-chips-for="${i}"]`);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("tasks bar visibility", () => {
  it("shows with counts once nothing is pending", () => {
    const { unmount } = mount(recWith());
    expect(bar()?.textContent).toContain("2 action items");
    expect(bar()?.textContent).toContain("Check owners and dates, then add them to the project board.");
    expect(button("Create 2 tasks")).toBeTruthy();
    unmount();
  });

  it("names the unmatched owners", () => {
    const { unmount } = mount(recWith());
    expect(bar()?.textContent).toContain("1 owner needs a pick.");
    unmount();
  });

  it("pluralizes the unmatched owners sentence", () => {
    const items = ITEMS.map((i) => ({ ...i, ownerUserId: null }));
    const { unmount } = mount(recWith(items));
    expect(bar()?.textContent).toContain("2 owners need a pick.");
    unmount();
  });

  it("uses the singular for one item", () => {
    const { unmount } = mount(recWith([ITEMS[0]!]));
    expect(bar()?.textContent).toContain("1 action item");
    expect(button("Create 1 task")).toBeTruthy();
    unmount();
  });

  it("is hidden while marks are pending", () => {
    const { unmount } = mount(recWith(ITEMS, { pendingMarks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }] }));
    expect(document.body.textContent).not.toContain("action items");
    expect(document.querySelector("[data-action-chips-for]")).toBeNull();
    unmount();
  });

  it("is hidden when every item already has a task", () => {
    const items = ITEMS.map((i, n) => ({ ...i, taskId: `t${n}` }));
    const { unmount } = mount(recWith(items));
    expect(bar()).toBeNull();
    unmount();
  });

  it("is hidden for a viewer who cannot create tasks, with read-only chips", () => {
    const { unmount } = mount(recWith(ITEMS, { canCreateTasks: false }));
    expect(bar()).toBeNull();
    expect(chipsFor(0)?.textContent).toContain("Maya Chen");
    expect(chipsFor(0)?.querySelector("input")).toBeNull();
    unmount();
  });

  it("is hidden without a project", () => {
    const { unmount } = mount(recWith(ITEMS, { projectId: null }));
    expect(bar()).toBeNull();
    unmount();
  });

  it("Not now hides it and stays hidden for the same Enhance", () => {
    const rec = recWith();
    const first = mount(rec);
    click(button("Not now"));
    expect(bar()).toBeNull();
    first.unmount();
    document.body.innerHTML = "";
    const second = mount(rec);
    expect(bar()).toBeNull();
    second.unmount();
  });

  it("a new Enhance brings it back after a dismissal", () => {
    const first = mount(recWith());
    click(button("Not now"));
    first.unmount();
    document.body.innerHTML = "";
    const next = recWith();
    next.enhanceNotes!.snapshotAt = "snap-2";
    const second = mount(next);
    expect(bar()?.textContent).toContain("2 action items");
    second.unmount();
  });

  it("offers Enhance again in its menu", () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    click(document.querySelector('button[aria-label="More"]')!);
    click([...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes("Enhance again"))!);
    expect(rec.enhanceNow).toHaveBeenCalled();
    unmount();
  });
});

describe("creating tasks", () => {
  it("sends the checked, untasked items with the chosen owner and due date", async () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    await act(async () => {
      button("Create 2 tasks").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(rec.createTasksFromItems).toHaveBeenCalledWith([
      { index: 0, title: ITEMS[0]!.text, assigneeId: "u-maya", dueAt: new Date("2026-10-23").toISOString() },
      { index: 1, title: ITEMS[1]!.text, assigneeId: undefined, dueAt: undefined },
    ]);
    unmount();
  });

  it("skips items that already have a task", async () => {
    const rec = recWith([{ ...ITEMS[0]!, taskId: "t0" }, ITEMS[1]!]);
    const { unmount } = mount(rec);
    await act(async () => {
      button("Create 1 task").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((rec.createTasksFromItems as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(1);
    expect((rec.createTasksFromItems as ReturnType<typeof vi.fn>).mock.calls[0]![0][0].index).toBe(1);
    unmount();
  });

  it("does not send an excluded item", async () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    click(document.querySelector(`input[aria-label="Make a task: ${ITEMS[1]!.text}"]`)!);
    expect(button("Create 1 task")).toBeTruthy();
    await act(async () => {
      button("Create 1 task").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const sent = (rec.createTasksFromItems as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sent.map((s: { index: number }) => s.index)).toEqual([0]);
    unmount();
  });

  it("shows Creating while busy", async () => {
    let finish: (ok: boolean) => void = () => {};
    const rec = recWith(ITEMS, { createTasksFromItems: vi.fn(() => new Promise<boolean>((r) => (finish = r))) });
    const { unmount } = mount(rec);
    click(button("Create 2 tasks"));
    expect(button("Creating…").disabled).toBe(true);
    await act(async () => finish(true));
    unmount();
  });

  it("shows the success state with a board link, then hides after 4 seconds", async () => {
    vi.useFakeTimers();
    const rec = recWith();
    const { unmount } = mount(rec);
    await act(async () => {
      button("Create 2 tasks").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(bar()?.textContent).toContain("Added 2 tasks to the project board");
    expect(document.querySelector('a[href="/projects/p1?tab=progress"]')?.textContent).toBe("View board");
    act(() => {
      vi.advanceTimersByTime(SUCCESS_VISIBLE_MS - 1);
    });
    expect(bar()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(bar()).toBeNull();
    unmount();
  });

  it("shows no success state when creation fails", async () => {
    const rec = recWith(ITEMS, { createTasksFromItems: vi.fn(async () => false) });
    const { unmount } = mount(rec);
    await act(async () => {
      button("Create 2 tasks").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(bar()?.textContent).not.toContain("Added");
    expect(button("Create 2 tasks")).toBeTruthy();
    unmount();
  });

  it("clears the success timer on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = mount(recWith());
    await act(async () => {
      button("Create 2 tasks").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const before = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBeLessThan(before);
  });
});

describe("action item chips", () => {
  it("renders one chip group per matching checklist block and none for other blocks", () => {
    const { unmount } = mount(recWith());
    expect(chipsFor(0)).not.toBeNull();
    expect(chipsFor(1)).not.toBeNull();
    expect(document.querySelectorAll("[data-action-chips-for]")).toHaveLength(2);
    expect(editorRoot.querySelectorAll("[data-action-chips]")).toHaveLength(2);
    unmount();
  });

  it("shows the matched owner and an unmatched amber chip", () => {
    const { unmount } = mount(recWith());
    expect(chipsFor(0)!.querySelector<HTMLInputElement>("input[role=combobox]")!.value).toBe("Maya Chen");
    expect(chipsFor(1)!.querySelector("input[role=combobox]")!.getAttribute("placeholder")).toBe("“Jordan” · pick owner");
    unmount();
  });

  it("shows Add owner and Add date when the plan has neither", () => {
    const { unmount } = mount(recWith([{ text: ITEMS[0]!.text }]));
    expect(chipsFor(0)!.querySelector("input[role=combobox]")!.getAttribute("placeholder")).toBe("Add owner");
    expect(chipsFor(0)!.textContent).toContain("Add date");
    unmount();
  });

  it("picking an owner from the unmatched chip sets the owner and clears the unmatched count", async () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    const input = chipsFor(1)!.querySelector<HTMLInputElement>("input[role=combobox]")!;
    act(() => input.focus());
    expect(document.body.textContent).toContain("In this meeting");
    click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Jordan Lee"))!);
    expect(chipsFor(1)!.querySelector<HTMLInputElement>("input[role=combobox]")!.value).toBe("Jordan Lee");
    expect(bar()?.textContent).not.toContain("needs a pick");
    await act(async () => {
      button("Create 2 tasks").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const sent = (rec.createTasksFromItems as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sent[1].assigneeId).toBe("u-jordan");
    unmount();
  });

  it("excluded items render muted", () => {
    const { unmount } = mount(recWith());
    click(document.querySelector(`input[aria-label="Make a task: ${ITEMS[1]!.text}"]`)!);
    expect(chipsFor(1)!.firstElementChild!.className).toContain("opacity-50");
    expect(chipsFor(1)!.querySelector("input[role='combobox']")).toBeNull();
    unmount();
  });

  it("replaces the chips with a task link once the item has a task", () => {
    const { unmount } = mount(recWith([{ ...ITEMS[0]!, taskId: "t9" }, ITEMS[1]!]));
    const link = chipsFor(0)!.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/projects/p1?tab=progress&task=t9");
    expect(link.textContent).toBe("Task");
    expect(chipsFor(0)!.querySelector("input")).toBeNull();
    unmount();
  });

  it("repositions beneath the line on a narrow screen", () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    const { unmount } = mount(recWith());
    const style = (chipsFor(0) as HTMLElement).style;
    expect(style.left).not.toBe("");
    expect(style.right).toBe("");
    unmount();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
  });
});
