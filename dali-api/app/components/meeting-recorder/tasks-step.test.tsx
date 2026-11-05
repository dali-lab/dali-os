// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { TaskProject } from "~/components/doc/task/task-api";
import { createElement, act } from "react";
import { MemoryRouter } from "react-router";
import { ActionItemDraftProvider, SUCCESS_VISIBLE_MS } from "./action-item-draft";
import { ActionItemChips } from "./ActionItemChips";
import { EnhanceBar } from "./EnhanceBar";
import { makeRec, mountDom } from "./test-support";
import type { EnhanceActionItem } from "./enhance-plan";
import type { UseMeetingRecording } from "./use-meeting-recording";

let projectsMock: TaskProject[] = [];
vi.mock("~/components/doc/task/task-api", () => ({ useTaskProjects: () => projectsMock }));

let editorRoot: HTMLElement;

const BLOCKS = [
  { id: "h", type: "heading", text: "Tasks" },
  { id: "b1", type: "paragraph", text: "Add two reviewers to the 26W cycle" },
  { id: "b2", type: "paragraph", text: "Send the catering quote" },
  { id: "h2", type: "heading", text: "Notes" },
  { id: "b3", type: "paragraph", text: "Unrelated paragraph" },
];
const [HEADING, LINE_A, LINE_B, NOTES_HEADING, UNRELATED] = BLOCKS as [
  (typeof BLOCKS)[number],
  (typeof BLOCKS)[number],
  (typeof BLOCKS)[number],
  (typeof BLOCKS)[number],
  (typeof BLOCKS)[number],
];
const BOTH_LINES = [HEADING, LINE_A, LINE_B, NOTES_HEADING, UNRELATED];
const ONLY_A = [HEADING, LINE_A, NOTES_HEADING, UNRELATED];
const ONLY_B = [HEADING, LINE_B, NOTES_HEADING, UNRELATED];
const NO_LINES = [NOTES_HEADING, UNRELATED];

function buildEditor() {
  editorRoot = document.createElement("div");
  editorRoot.innerHTML = BLOCKS.map(
    (b) => `<div class="bn-block-outer" data-id="${b.id}"><div class="bn-block"><div class="bn-block-content"><p>${b.text}</p></div></div></div>`,
  ).join("");
  const doc = document.createElement("div");
  doc.className = "dali-doc";
  const host = document.createElement("div");
  host.className = "dali-doc-overlay-host";
  doc.append(host, editorRoot);
  document.body.appendChild(doc);
}

const overlayHostEl = () => document.querySelector(".dali-doc-overlay-host")!;

const ITEMS: EnhanceActionItem[] = [
  { text: "Add two reviewers to the 26W cycle", ownerName: "Maya Chen", ownerUserId: "u-maya", due: "2026-10-23" },
  { text: "Send the catering quote", ownerName: "Jordan", ownerUserId: null, due: null },
];

function recWith(items: EnhanceActionItem[] = ITEMS, extra: Partial<UseMeetingRecording> = {}) {
  return makeRec({
    phase: "done",
    enhancedAt: "2026-10-18T12:00:00Z",
    canEdit: true,
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
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text);
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
  projectsMock = [{ id: "p1", name: "Campus Compost" }];
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  for (const style of document.head.querySelectorAll("style[data-enhance-rules]")) style.remove();
});

const chipRules = () => document.querySelector('style[data-enhance-rules="chips"]')?.textContent ?? "";

const noteState = (blocks: typeof BLOCKS) => ({ getNoteState: () => ({ blocks, bodyText: "" }) });
const sent = (rec: UseMeetingRecording) => (rec.createTasksFromItems as ReturnType<typeof vi.fn>).mock.calls[0]![0];
const addButton = (text: string) => button(`Add task: ${text}`);
const clickAsync = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const pickStatus = (text: string, label: string) => {
  click(document.querySelector(`button[aria-label="Status for ${text}"]`)!);
  click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes(label))!);
};

describe("tasks bar visibility", () => {
  it("appears once the editor becomes ready and the note version bumps", () => {
    let state: { blocks: typeof BLOCKS; bodyText: string } | null = null;
    const getNoteState = () => state;
    buildEditor();
    const first = recWith(ITEMS, { getNoteState, noteVersion: 0 });
    const ui = mountDom(createElement(MemoryRouter, null, createElement(ActionItemDraftProvider, { rec: first, children: createElement(EnhanceBar, { rec: first }) })));
    expect(bar()?.textContent ?? "").not.toContain("suggested task");
    state = { blocks: BLOCKS, bodyText: "" };
    const next = recWith(ITEMS, { getNoteState, noteVersion: 1 });
    ui.rerender(createElement(MemoryRouter, null, createElement(ActionItemDraftProvider, { rec: next, children: createElement(EnhanceBar, { rec: next }) })));
    expect(bar()?.textContent).toContain("2 suggested tasks");
    ui.unmount();
  });

  it("shows the counts and copy once nothing is pending", () => {
    const { unmount } = mount(recWith());
    expect(bar()?.textContent).toContain("2 suggested tasks");
    expect(bar()?.textContent).toContain("Check owners and dates, then add them.");
    expect(button("Add all")).toBeTruthy();
    expect(button("Not now")).toBeTruthy();
    unmount();
  });

  it("uses the singular for one item", () => {
    const { unmount } = mount(recWith([ITEMS[0]!], noteState(ONLY_A)));
    expect(bar()?.textContent).toContain("1 suggested task");
    expect(bar()?.textContent).not.toContain("1 suggested tasks");
    unmount();
  });

  it("is hidden once the suggestion lines are gone from the note, even with a plan", () => {
    const { unmount } = mount(recWith(ITEMS, noteState(NO_LINES)));
    expect(document.body.textContent).not.toContain("suggested task");
    expect(document.querySelector("[data-action-chips-for]")).toBeNull();
    unmount();
  });

  it("ignores lines outside the Tasks section", () => {
    const { unmount } = mount(recWith(ITEMS, noteState([UNRELATED, { id: "b1", type: "paragraph", text: LINE_A.text }])));
    expect(document.body.textContent).not.toContain("suggested task");
    expect(document.querySelector("[data-action-chips-for]")).toBeNull();
    unmount();
  });

  it("still finds old checklist lines under an Action items heading", () => {
    const old = [{ id: "h", type: "heading", text: "Action items" }, { ...LINE_A, type: "checkListItem" }];
    const { unmount } = mount(recWith([ITEMS[0]!], noteState(old)));
    expect(bar()?.textContent).toContain("1 suggested task");
    expect(chipsFor(0)).not.toBeNull();
    unmount();
  });

  it("is hidden while marks are pending", () => {
    const { unmount } = mount(recWith(ITEMS, { pendingMarks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }] }));
    expect(document.body.textContent).not.toContain("suggested task");
    expect(document.querySelector("[data-action-chips-for]")).toBeNull();
    unmount();
  });

  it("is hidden when every item already has a task", () => {
    const items = ITEMS.map((i, n) => ({ ...i, taskId: `t${n}` }));
    const { unmount } = mount(recWith(items));
    expect(bar()).toBeNull();
    expect(document.querySelector("[data-action-chips-for]")).toBeNull();
    unmount();
  });

  it("is hidden for a viewer who cannot edit, with read-only chips", () => {
    const { unmount } = mount(recWith(ITEMS, { canEdit: false }));
    expect(bar()).toBeNull();
    expect(chipsFor(0)?.textContent).toContain("Maya Chen");
    expect(chipsFor(0)?.querySelector("input")).toBeNull();
    expect(chipsFor(0)?.querySelector("button")).toBeNull();
    unmount();
  });

  it("is hidden when the viewer has no project to add tasks to", () => {
    projectsMock = [];
    const { unmount } = mount(recWith());
    expect(bar()).toBeNull();
    unmount();
  });

  it("is hidden when the note's project is not one the viewer can add to", () => {
    projectsMock = [{ id: "other", name: "Other" }];
    const { unmount } = mount(recWith());
    expect(bar()).toBeNull();
    unmount();
  });

  it("shows on a note without a project when the viewer has projects", () => {
    const { unmount } = mount(recWith(ITEMS, { projectId: null }));
    expect(bar()?.textContent).toContain("2 suggested tasks");
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
    expect(bar()?.textContent).toContain("2 suggested tasks");
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

describe("adding tasks", () => {
  it("Add all sends every item with its status, owner, due date and line", async () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    await clickAsync(button("Add all"));
    expect(rec.createTasksFromItems).toHaveBeenCalledWith([
      { index: 0, title: ITEMS[0]!.text, assigneeId: "u-maya", dueAt: new Date("2026-10-23").toISOString(), status: "Todo", projectId: undefined, blockId: "b1" },
      { index: 1, title: ITEMS[1]!.text, assigneeId: undefined, dueAt: undefined, status: "Backlog", projectId: undefined, blockId: "b2" },
    ]);
    unmount();
  });

  it("skips items that already have a task", async () => {
    const rec = recWith([{ ...ITEMS[0]!, taskId: "t0" }, ITEMS[1]!]);
    const { unmount } = mount(rec);
    await clickAsync(button("Add all"));
    expect(sent(rec).map((s: { index: number }) => s.index)).toEqual([1]);
    unmount();
  });

  it("Add sends only that item", async () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    await clickAsync(addButton(ITEMS[0]!.text));
    expect(rec.createTasksFromItems).toHaveBeenCalledTimes(1);
    expect(sent(rec)).toEqual([
      { index: 0, title: ITEMS[0]!.text, assigneeId: "u-maya", dueAt: new Date("2026-10-23").toISOString(), status: "Todo", projectId: undefined, blockId: "b1" },
    ]);
    unmount();
  });

  it("titles the task with the line as it reads in the note now", async () => {
    const edited = [{ ...LINE_A, text: "Add two reviewers to the 26W cycle by Friday" }, LINE_B];
    const rec = recWith(ITEMS, noteState([HEADING, ...edited]));
    const { unmount } = mount(rec);
    await clickAsync(button("Add all"));
    expect(sent(rec)[0].title).toBe("Add two reviewers to the 26W cycle by Friday");
    unmount();
  });

  it("never sends an item whose line was deleted from the note", async () => {
    const rec = recWith(ITEMS, noteState(ONLY_B));
    const { unmount } = mount(rec);
    expect(bar()?.textContent).toContain("1 suggested task");
    await clickAsync(button("Add all"));
    expect(sent(rec).map((s: { index: number }) => s.index)).toEqual([1]);
    unmount();
  });

  it("shows Adding while busy and disables every Add", async () => {
    let finish: (ok: boolean) => void = () => {};
    const rec = recWith(ITEMS, { createTasksFromItems: vi.fn(() => new Promise<boolean>((r) => (finish = r))) });
    const { unmount } = mount(rec);
    click(addButton(ITEMS[0]!.text));
    expect(button("Adding…").disabled).toBe(true);
    expect(addButton(ITEMS[1]!.text).disabled).toBe(true);
    click(addButton(ITEMS[1]!.text));
    expect(rec.createTasksFromItems).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    unmount();
  });

  it("shows Added N tasks with a board link once every item has a task, then hides after 4 seconds", async () => {
    vi.useFakeTimers();
    const rec = recWith();
    const ui = mount(rec);
    await clickAsync(button("Add all"));
    const tasked = recWith([{ ...ITEMS[0]!, taskId: "t0" }, { ...ITEMS[1]!, taskId: "t1" }]);
    ui.rerender(createElement(MemoryRouter, null, createElement(ActionItemDraftProvider, { rec: tasked, children: createElement(EnhanceBar, { rec: tasked }) })));
    expect(bar()?.textContent).toContain("Added 2 tasks");
    expect(document.querySelector('a[href="/projects/p1?tab=progress"]')?.textContent).toBe("View board");
    act(() => {
      vi.advanceTimersByTime(SUCCESS_VISIBLE_MS - 1);
    });
    expect(bar()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(bar()).toBeNull();
    ui.unmount();
  });

  it("keeps the bar, with an Added note, while suggestions remain", async () => {
    vi.useFakeTimers();
    const { unmount } = mount(recWith());
    await clickAsync(addButton(ITEMS[0]!.text));
    expect(bar()?.textContent).toContain("Added 1 task");
    expect(button("Add all")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(SUCCESS_VISIBLE_MS);
    });
    expect(bar()?.textContent).not.toContain("Added");
    unmount();
  });

  it("shows no success state when adding fails", async () => {
    const rec = recWith(ITEMS, { createTasksFromItems: vi.fn(async () => false) });
    const { unmount } = mount(rec);
    await clickAsync(button("Add all"));
    expect(bar()?.textContent).not.toContain("Added");
    unmount();
  });

  it("clears the success timer on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = mount(recWith());
    await clickAsync(button("Add all"));
    const before = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBeLessThan(before);
  });

  it("links to no board when the added tasks span several projects", async () => {
    projectsMock = [
      { id: "p1", name: "Campus Compost" },
      { id: "p2", name: "Trail Maps" },
    ];
    vi.useFakeTimers();
    const rec = recWith(ITEMS, { projectId: null });
    const ui = mount(rec);
    pickProject(ITEMS[0]!.text, "Campus Compost");
    pickProject(ITEMS[1]!.text, "Trail Maps");
    await clickAsync(button("Add all"));
    const tasked = recWith(ITEMS.map((i, n) => ({ ...i, taskId: `t${n}` })), { projectId: null });
    ui.rerender(createElement(MemoryRouter, null, createElement(ActionItemDraftProvider, { rec: tasked, children: createElement(EnhanceBar, { rec: tasked }) })));
    expect(bar()?.textContent).toContain("Added 2 tasks");
    expect(document.querySelector("a")).toBeNull();
    ui.unmount();
  });
});

const pickProject = (text: string, name: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="Project for ${text}"]`)!;
  act(() => input.focus());
  click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes(name))!);
};

describe("date required for tasks outside Backlog", () => {
  it("starts undated items in Backlog and dated items in To do", () => {
    const { unmount } = mount(recWith());
    expect(document.querySelector(`button[aria-label="Status for ${ITEMS[0]!.text}"]`)?.textContent).toContain("To do");
    expect(document.querySelector(`button[aria-label="Status for ${ITEMS[1]!.text}"]`)?.textContent).toContain("Backlog");
    unmount();
  });

  it("blocks Add on an undated item once it leaves Backlog, and Add all skips it", async () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    pickStatus(ITEMS[1]!.text, "In progress");
    expect(addButton(ITEMS[1]!.text).disabled).toBe(true);
    expect(addButton(ITEMS[0]!.text).disabled).toBe(false);
    await clickAsync(button("Add all"));
    expect(sent(rec).map((s: { index: number }) => s.index)).toEqual([0]);
    unmount();
  });

  it("disables Add all when no item can be added", () => {
    const rec = recWith([{ ...ITEMS[1]! }], noteState(ONLY_B));
    const { unmount } = mount(rec);
    pickStatus(ITEMS[1]!.text, "In progress");
    expect(button("Add all").disabled).toBe(true);
    unmount();
  });

  it("sends the picked status once the item has a date", async () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    pickStatus(ITEMS[0]!.text, "In progress");
    await clickAsync(addButton(ITEMS[0]!.text));
    expect(sent(rec)[0].status).toBe("InProgress");
    unmount();
  });
});

describe("project picker", () => {
  it("is absent on a note with a project", () => {
    const { unmount } = mount(recWith());
    expect(document.querySelector('input[aria-label^="Project for"]')).toBeNull();
    unmount();
  });

  it("is offered on a note without a project, blocking Add until one is picked", async () => {
    projectsMock = [
      { id: "p1", name: "Campus Compost" },
      { id: "p2", name: "Trail Maps" },
    ];
    const rec = recWith(ITEMS, { projectId: null });
    const { unmount } = mount(rec);
    expect(addButton(ITEMS[0]!.text).disabled).toBe(true);
    pickProject(ITEMS[0]!.text, "Trail Maps");
    expect(addButton(ITEMS[0]!.text).disabled).toBe(false);
    await clickAsync(addButton(ITEMS[0]!.text));
    expect(sent(rec)[0].projectId).toBe("p2");
    unmount();
  });

  it("defaults to the only project the viewer has", async () => {
    const rec = recWith(ITEMS, { projectId: null });
    const { unmount } = mount(rec);
    expect(addButton(ITEMS[0]!.text).disabled).toBe(false);
    await clickAsync(button("Add all"));
    expect(sent(rec).map((s: { projectId?: string }) => s.projectId)).toEqual(["p1", "p1"]);
    unmount();
  });
});

describe("dismissing a suggestion", () => {
  it("removes that line from the note", () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    click(button(`Dismiss suggestion: ${ITEMS[1]!.text}`));
    expect(rec.removeBlock).toHaveBeenCalledWith("b2");
    expect(rec.removeBlock).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("suggestion chips", () => {
  it("renders one chip group per matching line and none for other blocks", () => {
    const { unmount } = mount(recWith());
    expect(chipsFor(0)).not.toBeNull();
    expect(chipsFor(1)).not.toBeNull();
    expect(document.querySelectorAll("[data-action-chips-for]")).toHaveLength(2);
    expect(editorRoot.querySelectorAll("[data-action-chips], [style]")).toHaveLength(0);
    unmount();
  });

  it("offers status, owner, due, Add and dismiss on each line, with no checkbox", () => {
    const { unmount } = mount(recWith());
    const group = chipsFor(0)!;
    expect(group.querySelector(`button[aria-label="Status for ${ITEMS[0]!.text}"]`)).not.toBeNull();
    expect(group.querySelector("input[role=combobox]")).not.toBeNull();
    expect(group.textContent).toContain("Add");
    expect(group.querySelector(`button[aria-label="Dismiss suggestion: ${ITEMS[0]!.text}"]`)).not.toBeNull();
    expect(group.querySelector('input[type="checkbox"]')).toBeNull();
    unmount();
  });

  it("reserves exactly the rendered chip width plus 12px on the right, and the chip height plus 8px when narrow", () => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.hasAttribute("data-action-chips-for")) {
        return { top: 0, left: 0, right: 300, bottom: 64, width: 300, height: 64, x: 0, y: 0, toJSON() {} } as DOMRect;
      }
      return original.call(this);
    };
    const { unmount } = mount(recWith());
    expect(chipRules()).toContain(
      '@media (min-width: 700px) {\n.dali-doc .bn-block-outer[data-id="b1"] > .bn-block > .bn-block-content { padding-right: 312px; }',
    );
    expect(chipRules()).toContain('[data-id="b2"] > .bn-block > .bn-block-content { padding-right: 312px; }');
    expect(chipRules()).toContain(
      '@media (max-width: 699px) {\n.dali-doc .bn-block-outer[data-id="b1"] > .bn-block > .bn-block-content { padding-bottom: 72px; }',
    );
    unmount();
    expect(document.querySelector("style[data-enhance-rules]")).toBeNull();
    Element.prototype.getBoundingClientRect = original;
  });

  it("never sets an attribute on the editor's nodes when its observers fire", async () => {
    const spy = vi.spyOn(Element.prototype, "setAttribute");
    const { unmount } = mount(recWith());
    editorRoot.querySelector('[data-id="b1"] p')!.textContent = `${LINE_A.text} `;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(spy.mock.contexts.filter((el) => el instanceof Element && editorRoot.contains(el))).toHaveLength(0);
    spy.mockRestore();
    unmount();
  });

  it("renders inside the note's overlay host, right-aligned to the line, with no scroll listener", () => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains("dali-doc-overlay-host")) {
        return { top: 100, bottom: 100, left: 20, right: 720, width: 700, height: 0, x: 20, y: 100, toJSON() {} } as DOMRect;
      }
      if (this.classList.contains("bn-block-content")) {
        return { top: 300, bottom: 330, left: 40, right: 620, width: 580, height: 30, x: 40, y: 300, toJSON() {} } as DOMRect;
      }
      return original.call(this);
    };
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { unmount } = mount(recWith());
    const chips = chipsFor(0) as HTMLElement;
    expect(chips.parentElement).toBe(overlayHostEl());
    expect(chips.style.position).toBe("absolute");
    expect(chips.style.top).toBe(`${300 - 100 + 1}px`);
    expect(chips.style.right).toBe(`${700 - (620 - 20) + 8}px`);
    raf.mockClear();
    window.dispatchEvent(new Event("scroll"));
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
    unmount();
    Element.prototype.getBoundingClientRect = original;
  });

  it("read-only chips explain an owner with no roster match", () => {
    const { unmount } = mount(recWith(ITEMS, { canEdit: false }));
    const owner = [...chipsFor(1)!.querySelectorAll("span")].find((el) => el.textContent === "Jordan")!;
    act(() => owner.dispatchEvent(new FocusEvent("focus", { bubbles: true })));
    act(() => owner.focus());
    expect(document.body.textContent).toContain("Jordan: no match on the roster");
    unmount();
  });

  it("shows the matched owner and an unmatched amber chip", () => {
    const { unmount } = mount(recWith());
    expect(chipsFor(0)!.querySelector<HTMLInputElement>("input[role=combobox]")!.value).toBe("Maya Chen");
    expect(chipsFor(1)!.querySelector("input[role=combobox]")!.getAttribute("placeholder")).toBe("“Jordan” · pick owner");
    unmount();
  });

  it("shows Add owner and Add date when the plan has neither", () => {
    const { unmount } = mount(recWith([{ text: ITEMS[0]!.text }], noteState(ONLY_A)));
    expect(chipsFor(0)!.querySelector("input[role=combobox]")!.getAttribute("placeholder")).toBe("Add owner");
    expect(chipsFor(0)!.textContent).toContain("Add date");
    unmount();
  });

  it("picking an owner from the unmatched chip sets the owner", async () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    const input = chipsFor(1)!.querySelector<HTMLInputElement>("input[role=combobox]")!;
    act(() => input.focus());
    expect(document.body.textContent).toContain("In this meeting");
    click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Jordan Lee"))!);
    expect(chipsFor(1)!.querySelector<HTMLInputElement>("input[role=combobox]")!.value).toBe("Jordan Lee");
    await clickAsync(button("Add all"));
    expect(sent(rec)[1].assigneeId).toBe("u-jordan");
    unmount();
  });

  it("shows nothing on a line whose item already has a task", () => {
    const { unmount } = mount(recWith([{ ...ITEMS[0]!, taskId: "t9" }, ITEMS[1]!]));
    expect(chipsFor(0)).toBeNull();
    expect(chipsFor(1)).not.toBeNull();
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

describe("enhance error note", () => {
  it("shows the error under the tasks bar", () => {
    const { unmount } = mount(recWith(ITEMS, { enhanceError: "The note is still loading. Try again in a moment." }));
    expect(bar()?.textContent).toContain("The note is still loading. Try again in a moment.");
    unmount();
  });
});

describe("bar menu for non-editors", () => {
  it("shows no tasks bar and no More menu to a viewer who cannot edit", () => {
    const { unmount } = mount(recWith(ITEMS, { canEdit: false }));
    expect(bar()).toBeNull();
    expect(document.querySelector('[aria-label="More"]')).toBeNull();
    unmount();
  });
});
