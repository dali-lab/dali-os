// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const confirm = vi.fn();
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));

const { WeekView } = await import("../WeekView");
import type { TaskboardData } from "../types";
import type { StoredTask } from "~/education/lib/taskboard/taskboard.server";

const task = (over: Partial<StoredTask> & { id: string }): StoredTask => ({
  title: over.id, description: null, periodId: "f", milestoneId: null, week: 8, weekday: 3,
  status: "Backlog", assigneeIds: ["me"], completedAt: null, ...over,
});

const base = (tasks: StoredTask[]): TaskboardData => ({
  termWeeks: 10,
  periods: [{ id: "f", name: "Fall 2026", shortName: "26F", kind: "Term", startDate: "2026-09-13", weekCount: 10 }],
  milestones: [{ id: "m1", periodId: "f", name: "Launch", description: null, startWeek: 6, endWeek: 10 }],
  tasks,
  members: [
    { id: "me", name: "Joyce Zou", photoUrl: null },
    { id: "ar", name: "Arthur Ray", photoUrl: null },
  ],
  today: "2026-11-04",
  current: { periodId: "f", week: 8, between: false },
  viewed: { periodId: "f", week: 8 },
  userId: "me",
});

let container: HTMLDivElement;
let root: Root;
const submit = vi.fn();
const openDialog = vi.fn();
const goTo = vi.fn();

const render = (data: TaskboardData, everyone = true, reveal: { key: string; nonce: number } | null = null) =>
  act(async () =>
    root.render(createElement(WeekView, { data, reveal, everyone, onEveryoneChange: vi.fn(), openDialog, goTo, submit })),
  );
const click = (el: Element | null) => act(async () => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`);
const byText = (text: string | RegExp) =>
  [...container.querySelectorAll("button")].find((b) =>
    typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? ""),
  ) ?? null;
const text = () => container.textContent ?? "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("backlog", () => {
  const data = () =>
    base([
      task({ id: "a", title: "Plan launch", milestoneId: "m1", week: 3 }),
      task({ id: "b", title: "Ship launch", milestoneId: "m1", week: 5, status: "Done", completedAt: "2026-11-02T10:00:00Z" }),
      task({ id: "c", title: "Loose thing", assigneeIds: [] }),
    ]);

  it("groups by milestone with week span and progress, loose last", async () => {
    await render(data());
    expect(text()).toContain("Launch");
    expect(text()).toContain("Wk 6 to 10 · 1/2");
    expect(text()).toContain("Loose tasks");
    expect(text()).toContain("1 waiting");
    expect(text().indexOf("Launch")).toBeLessThan(text().indexOf("Loose tasks"));
  });

  it("shows owner, week and day on each row", async () => {
    await render(data());
    expect(text()).toContain("Joyce · Wk 3 Wed");
    expect(text()).toContain("Unassigned · Wk 8 Wed");
  });

  it("opens only the groups relevant to the viewed week", async () => {
    const other = { ...base([task({ id: "e", title: "Early work", milestoneId: "m2", week: 2 })]) };
    other.milestones = [
      ...other.milestones,
      { id: "m2", periodId: "f", name: "Kickoff", description: null, startWeek: 1, endWeek: 3 },
    ];
    other.tasks = [...other.tasks, task({ id: "l", title: "Launch prep", milestoneId: "m1", week: 7 })];
    await render(other);
    expect(text()).toContain("Launch prep");
    expect(text()).not.toContain("Early work");
    await click(byText(/Kickoff/));
    expect(text()).toContain("Early work");
  });

  it("keeps loose tasks closed unless one is planned for the viewed week", async () => {
    await render(base([task({ id: "z", title: "Later loose", week: 3, assigneeIds: [] })]));
    expect(text()).not.toContain("Later loose");
    await click(byText(/Loose tasks/));
    expect(text()).toContain("Later loose");
  });

  it("nests milestone tasks and leaves loose tasks flat", async () => {
    await render(data());
    const nested = byText("Plan launch")!.closest("div.border-l-2");
    expect(nested).not.toBeNull();
    expect(byText("Loose thing")!.closest("div.border-l-2")).toBeNull();
  });

  it("has no drag grip, the whole row drags", async () => {
    await render(data());
    expect(container.querySelector('[title="Drag into the week"]')).not.toBeNull();
    expect(container.querySelector("svg.lucide-grip-vertical")).toBeNull();
  });

  it("opens a closed group when asked to reveal it, even from the collapsed rail", async () => {
    const closed = base([task({ id: "e", title: "Early work", milestoneId: "m2", week: 2 })]);
    closed.milestones = [...closed.milestones, { id: "m2", periodId: "f", name: "Kickoff", description: null, startWeek: 1, endWeek: 3 }];
    await render(closed);
    expect(text()).not.toContain("Early work");
    await click(byLabel("Collapse backlog"));
    await render(closed, true, { key: "m2", nonce: 1 });
    expect(text()).toContain("Early work");
  });

  it("collapses and expands a group", async () => {
    await render(data());
    await click(byText(/Launch/));
    expect(text()).not.toContain("Plan launch");
    await click(byText(/Launch/));
    expect(text()).toContain("Plan launch");
  });

  it("opens the milestone detail from the group header", async () => {
    await render(data());
    await click(byLabel("Open Launch"));
    expect(openDialog).toHaveBeenCalledWith({ kind: "milestone-detail", milestoneId: "m1" });
  });

  it("pulls an assigned task into the viewed week", async () => {
    await render(data());
    await click(byText("Wk 8"));
    expect(submit).toHaveBeenCalledWith({ intent: "task-move", id: "a", status: "Todo", periodId: "f", week: "8" });
  });

  it("pulls an unassigned task in for me", async () => {
    await render(data());
    await click(byLabel("Pull in for me"));
    expect(submit).toHaveBeenCalledWith({ intent: "task-move", id: "c", status: "Todo", periodId: "f", week: "8" });
  });

  it("collapses to a rail with the waiting count and expands again", async () => {
    await render(data());
    await click(byLabel("Collapse backlog"));
    expect(text()).not.toContain("Plan launch");
    expect(byLabel("Expand backlog")).not.toBeNull();
    expect(text()).toContain("2");
    await click(byLabel("Expand backlog"));
    expect(text()).toContain("Plan launch");
  });

  it("opens a task from its title", async () => {
    await render(data());
    await click(byText("Plan launch"));
    expect(openDialog).toHaveBeenCalledWith({ kind: "task", taskId: "a" });
  });

  it("hides other people's backlog rows when Just me is on", async () => {
    await render(base([task({ id: "x", title: "Arthur's", assigneeIds: ["ar"] }), task({ id: "y", title: "Mine" })]), false);
    expect(text()).toContain("Mine");
    expect(text()).not.toContain("Arthur's");
  });
});

describe("week columns", () => {
  it("moves cards with the Start and Done buttons", async () => {
    await render(base([task({ id: "t", status: "Todo" }), task({ id: "d", status: "Doing" })]));
    await click(byText("Start"));
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ id: "t", status: "Doing" }));
    await click(byText("Done"));
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ id: "d", status: "Done" }));
  });

  it("badges rolled over tasks and says where they came from", async () => {
    await render(base([task({ id: "late", status: "Todo", week: 7 })]));
    expect(text()).toContain("From wk 7");
    expect(text()).toContain("1 task rolled over from Week 7. Anything not done by Saturday moves to next week.");
  });

  it("dismisses the rollover notice and keeps it dismissed for that week", async () => {
    const data = base([task({ id: "late", status: "Todo", week: 7 })]);
    await render(data);
    await click(byLabel("Dismiss rollover notice"));
    expect(text()).not.toContain("rolled over");
    expect(text()).toContain("From wk 7");
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(data);
    expect(text()).not.toContain("rolled over");
  });

  it("brings the notice back on a different week that has rolled tasks", async () => {
    window.localStorage.setItem("education-taskboard:dismissed-rollover", JSON.stringify(["f:7"]));
    await render(base([task({ id: "late", status: "Todo", week: 7 })]));
    expect(text()).toContain("rolled over");
  });

  it("survives unreadable storage", async () => {
    window.localStorage.setItem("education-taskboard:dismissed-rollover", "{not json");
    await render(base([task({ id: "late", status: "Todo", week: 7 })]));
    expect(text()).toContain("rolled over");
  });

  it("opens a task from anywhere on its card, not only the title", async () => {
    await render(base([task({ id: "t", title: "Card task", status: "Todo" })]));
    const card = container.querySelector("article")!;
    await click(card);
    expect(openDialog).toHaveBeenLastCalledWith({ kind: "task", taskId: "t" });
    openDialog.mockClear();
    await click(card.querySelector("span.text-xs")!);
    expect(openDialog).toHaveBeenCalledTimes(1);
  });

  it("does not also open the task when a card button is pressed", async () => {
    await render(base([task({ id: "t", status: "Todo" })]));
    await click(byText("Start"));
    expect(openDialog).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalled();
  });

  it("opens backlog and done rows by clicking the row", async () => {
    await render(base([task({ id: "b", title: "Back row" }), task({ id: "d", status: "Done", completedAt: "2026-11-02T00:00:00Z" })]));
    await click(container.querySelector('[title="Drag into the week"]'));
    expect(openDialog).toHaveBeenLastCalledWith({ kind: "task", taskId: "b" });
    await click(byLabel("Open done"));
    const doneRow = byText("d")!.parentElement!;
    await click(doneRow);
    expect(openDialog).toHaveBeenLastCalledWith({ kind: "task", taskId: "d" });
  });

  it("shows no banner when nothing rolled over", async () => {
    await render(base([task({ id: "now", status: "Todo" })]));
    expect(text()).not.toContain("rolled over");
  });

  it("offers a way back to this week from another week", async () => {
    const data = base([]);
    await render({ ...data, viewed: { periodId: "f", week: 4 } });
    await click(byText("Back to this week"));
    expect(goTo).toHaveBeenCalledWith({ periodId: "f", week: 8 });
  });

  it("has no back button on the current week", async () => {
    await render(base([]));
    expect(byText("Back to this week")).toBeNull();
  });
});

describe("done", () => {
  const dones = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      task({ id: `d${i}`, title: `Done ${i}`, status: "Done", completedAt: new Date(Date.UTC(2026, 10, 1 + i)).toISOString() }),
    );

  it("starts collapsed as a rail with the count", async () => {
    await render(base(dones(3)));
    expect(byLabel("Open done")).not.toBeNull();
    expect(text()).not.toContain("Done 0");
  });

  it("caps the rail count at 99+", async () => {
    await render(base(dones(120)));
    expect(byLabel("Open done")!.closest('[data-testid="board-column"]')!.textContent).toContain("99+");
  });

  it("opens to the latest five, newest first, with a footnote", async () => {
    await render(base(dones(8)));
    await click(byLabel("Open done"));
    const shown = [...container.querySelectorAll("button")].map((b) => b.textContent).filter((t) => /^Done \d$/.test(t ?? ""));
    expect(shown).toEqual(["Done 7", "Done 6", "Done 5", "Done 4", "Done 3"]);
    expect(text()).toContain("Show all 8 (3 more)");
    expect(text()).toContain("Only this week's done tasks show here.");
  });

  it("shows everything, then goes back to five", async () => {
    await render(base(dones(8)));
    await click(byLabel("Open done"));
    await click(byText(/Show all 8/));
    expect(text()).toContain("Done 0");
    expect(text()).toContain("Show only the latest 5");
    await click(byText(/Show only the latest 5/));
    expect(text()).not.toContain("Done 0");
  });

  it("undoes into in progress", async () => {
    await render(base(dones(1)));
    await click(byLabel("Open done"));
    await click(byText("Undo"));
    expect(submit).toHaveBeenCalledWith({ intent: "task-move", id: "d0", status: "Doing", periodId: "f", week: "8" });
  });

  it("deletes only after confirming", async () => {
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await render(base(dones(1)));
    await click(byLabel("Open done"));
    await click(byLabel("Delete task"));
    expect(submit).not.toHaveBeenCalled();
    await click(byLabel("Delete task"));
    expect(submit).toHaveBeenCalledWith({ intent: "task-delete", id: "d0" });
  });

  it("can take the full width and shrink back", async () => {
    await render(base(dones(1)));
    await click(byLabel("Open done"));
    await click(byLabel("Expand done"));
    expect(byLabel("Shrink done")).not.toBeNull();
    await click(byLabel("Shrink done"));
    expect(byLabel("Expand done")).not.toBeNull();
  });

  it("collapses back to the rail", async () => {
    await render(base(dones(1)));
    await click(byLabel("Open done"));
    await click(byLabel("Collapse done"));
    expect(byLabel("Open done")).not.toBeNull();
  });
});

describe("empty states", () => {
  it("explains empty columns", async () => {
    await render(base([]));
    expect(text()).toContain("Nothing assigned yet. Pull from the backlog.");
    expect(text()).toContain("Nothing started");
    await click(byText(/Loose tasks/));
    expect(text()).toContain("Nothing waiting. All tasks are planned or done.");
  });

  it("asks for a term when there are no periods", async () => {
    await render({ ...base([]), periods: [], viewed: null, current: null });
    expect(text()).toContain("Add a term to start planning.");
  });

  it("adds a task straight into the To do or In progress column", async () => {
    await render(base([]));
    const adds = [...container.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Add task");
    expect(adds).toHaveLength(2);
    await click(adds[0]);
    expect(openDialog).toHaveBeenLastCalledWith({
      kind: "task",
      taskId: null,
      draft: { status: "Todo", assigneeIds: ["me"], periodId: "f", week: 8 },
    });
    await click(adds[1]);
    expect(openDialog).toHaveBeenLastCalledWith({
      kind: "task",
      taskId: null,
      draft: { status: "Doing", assigneeIds: ["me"], periodId: "f", week: 8 },
    });
  });
});
