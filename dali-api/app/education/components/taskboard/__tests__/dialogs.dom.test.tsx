// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }));

const { PeriodDialog } = await import("../PeriodDialog");
const { TaskDialog } = await import("../TaskDialog");
const { MilestoneDialog } = await import("../MilestoneDialog");
const { MilestoneDetail } = await import("../MilestoneDetail");
const { YearView } = await import("../YearView");
const { TermView } = await import("../TermView");
import type { TaskboardData } from "../types";

const data: TaskboardData = {
  termWeeks: 10,
  periods: [
    { id: "f", name: "Fall 2026", shortName: "26F", kind: "Term", startDate: "2026-09-13", weekCount: 10 },
    { id: "i", name: "Interim", shortName: "Int", kind: "Interim", startDate: "2026-11-22", weekCount: 6 },
  ],
  milestones: [{ id: "m1", periodId: "f", name: "Launch", description: null, startWeek: 2, endWeek: 4 }],
  tasks: [],
  members: [],
  today: "2026-11-04",
  current: { periodId: "f", week: 8, between: false },
  viewed: { periodId: "f", week: 8 },
  userId: "me",
};

let container: HTMLDivElement;
let root: Root;
const submit = vi.fn();
const onClose = vi.fn();
const openDialog = vi.fn();

const mount = (el: Parameters<Root["render"]>[0]) => act(async () => root.render(el));
const overlay = () => document.querySelector<HTMLElement>('[role="dialog"]');
const click = (el: Element | null) => act(async () => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (label: string | RegExp, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find((b) =>
    typeof label === "string" ? b.textContent?.trim() === label || b.getAttribute("aria-label") === label : label.test(b.textContent ?? ""),
  ) ?? null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("dialogs keep the modal overlay", () => {
  const cases: [string, () => Parameters<Root["render"]>[0]][] = [
    ["period", () => createElement(PeriodDialog, { data, periodId: null, submit, onClose, openDialog, busy: false })],
    ["task", () => createElement(TaskDialog, { data, taskId: null, submit, onClose, openDialog, busy: false })],
    ["milestone", () => createElement(MilestoneDialog, { data, milestoneId: null, submit, onClose, openDialog, busy: false })],
    ["milestone detail", () => createElement(MilestoneDetail, { data, milestoneId: "m1", onClose, openDialog })],
  ];

  it.each(cases)("%s dialog is a centered full-screen overlay", async (_n, build) => {
    await mount(build());
    const o = overlay()!;
    expect(o.className).toContain("fixed");
    expect(o.className).toContain("inset-0");
    expect(o.className).toContain("justify-center");
  });
});

describe("PeriodDialog", () => {
  const open = (periodId: string | null) =>
    mount(createElement(PeriodDialog, { data, periodId, submit, onClose, openDialog, busy: false }));
  const steppers = (label: string) => [...document.querySelectorAll(`button[aria-label="${label}"]`)] as HTMLButtonElement[];
  const submitForm = () =>
    act(async () => {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

  it("cannot create until a start date is picked", async () => {
    await open(null);
    expect(overlay()!.textContent).toContain("Where it lands in the year");
    expect(button("Create")!.disabled).toBe(true);
  });

  it("suggests a name by type and shows the type's length control", async () => {
    await open(null);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("New term");
    expect(overlay()!.textContent).toContain("Length");
    await click([...document.querySelectorAll('[aria-label="Type"] [role="radio"]')].find((r) => r.textContent === "Interim")!);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("Interim");
    expect(overlay()!.textContent).toContain("Ends");
  });

  it("edits an existing term and sends its id and new length", async () => {
    await open("f");
    expect(overlay()!.textContent).toContain("Edit term or period");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("Fall 2026");
    await click(steppers("Fewer weeks")[1]);
    await submitForm();
    expect(submit).toHaveBeenCalledWith(
      { intent: "period-save", id: "f", name: "Fall 2026", shortName: "26F", kind: "Term", startDate: "2026-09-13", weekCount: "9" },
      expect.any(Function),
    );
  });

  it("stops a term's length at 4 and 14 weeks", async () => {
    await open("f");
    for (let i = 0; i < 10; i++) await click(steppers("Fewer weeks")[1]);
    expect(steppers("Fewer weeks")[1].disabled).toBe(true);
    for (let i = 0; i < 12; i++) await click(steppers("More weeks")[1]);
    expect(steppers("More weeks")[1].disabled).toBe(true);
  });

  it("edits an interim with an end date instead of a length stepper", async () => {
    await open("i");
    expect(overlay()!.textContent).toContain("Ends");
    expect(steppers("Fewer weeks")).toHaveLength(1);
    expect(overlay()!.textContent).toContain("6 weeks. Pick any end date for interims and custom ranges.");
    await submitForm();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "i", kind: "Interim", startDate: "2026-11-22", weekCount: "6" }),
      expect.any(Function),
    );
  });

  it("saves the default term length as soon as it changes and keeps the panel open", async () => {
    await open("f");
    await click(steppers("More weeks")[0]);
    expect(submit).toHaveBeenCalledWith({ intent: "settings-save", termWeeks: "11" }, expect.any(Function));
    const after = submit.mock.calls[0][1] as () => unknown;
    expect(after()).toEqual({ kind: "period", periodId: "f" });
  });

  it("previews the year with every period", async () => {
    await open("f");
    const strip = document.querySelector('[aria-label="Year preview"]')!;
    expect(strip.textContent).toContain("26F");
    expect(strip.textContent).toContain("Int");
    expect(strip.textContent).toContain("10 wks");
  });

  it("offers delete only when editing", async () => {
    await open(null);
    expect(button("Delete")).toBeNull();
    await open("f");
    expect(button("Delete")).not.toBeNull();
  });
});

describe("editing a term from the views", () => {
  it("the year view has an edit button per term that opens that term", async () => {
    await mount(createElement(YearView, { data, openPeriod: vi.fn(), openDialog }));
    const edits = [...container.querySelectorAll('button[aria-label="Edit term"]')];
    expect(edits).toHaveLength(2);
    await click(edits[1]);
    expect(openDialog).toHaveBeenCalledWith({ kind: "period", periodId: "i" });
  });

  it("clicking a year block still opens the term, not the editor", async () => {
    const openPeriod = vi.fn();
    await mount(createElement(YearView, { data, openPeriod, openDialog }));
    await click(button(/Fall 2026/));
    expect(openPeriod).toHaveBeenCalledWith({ periodId: "f", week: 8 });
    expect(openDialog).not.toHaveBeenCalled();
  });

  it("the term view has an Edit term button for the viewed term", async () => {
    await mount(createElement(TermView, { data, openWeek: vi.fn(), openDialog }));
    await click(button("Edit term"));
    expect(openDialog).toHaveBeenCalledWith({ kind: "period", periodId: "f" });
  });

  it("add term opens a blank period dialog", async () => {
    await mount(createElement(YearView, { data, openPeriod: vi.fn(), openDialog }));
    await click(button(/Add term/));
    expect(openDialog).toHaveBeenCalledWith({ kind: "period", periodId: null });
  });
});

describe("assigning several people", () => {
  const people: TaskboardData = {
    ...data,
    members: [
      { id: "b", name: "Beth Cho", photoUrl: null },
      { id: "ar", name: "Arthur Ng", photoUrl: null },
      { id: "me", name: "Joyce Zou", photoUrl: null },
    ],
  };

  it("lists Joyce then Arthur first and sends everyone picked", async () => {
    await mount(createElement(TaskDialog, { data: people, taskId: null, submit, onClose, openDialog, busy: false }));
    const pills = [...document.querySelectorAll('button[aria-label^="Assign "]')].map((b) => b.getAttribute("aria-label"));
    expect(pills.slice(0, 2)).toEqual(["Assign Joyce Zou", "Assign Arthur Ng"]);
    await click(button("Assign Joyce Zou"));
    await click(button("Assign Arthur Ng"));
    const title = document.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Both of us");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Create task"));
    expect(submit.mock.calls[0][0]).toMatchObject({ assigneeIds: "me,ar" });
  });

  it("clears everyone with Later and removes one with a second click", async () => {
    await mount(createElement(TaskDialog, { data: people, taskId: null, draft: { assigneeIds: ["me", "ar"] }, submit, onClose, openDialog, busy: false }));
    await click(button("Assign Arthur Ng"));
    expect(button("Assign Arthur Ng")?.getAttribute("aria-pressed")).toBe("false");
    expect(button("Assign Joyce Zou")?.getAttribute("aria-pressed")).toBe("true");
    await click(button("Assign later"));
    expect(button("Assign Joyce Zou")?.getAttribute("aria-pressed")).toBe("false");
    expect(button("Assign later")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("creates in the column it was opened from", async () => {
    await mount(createElement(TaskDialog, { data: people, taskId: null, draft: { status: "Doing", assigneeIds: ["me"] }, submit, onClose, openDialog, busy: false }));
    const title = document.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Started already");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Create task"));
    expect(submit.mock.calls[0][0]).toMatchObject({ status: "Doing", assigneeIds: "me" });
  });
});
