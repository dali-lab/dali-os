// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TimeEntryDTO } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submits: { key: string; fields: Record<string, string>; options: unknown }[] = [];
vi.mock("react-router", () => ({
  useSubmit: () => (fields: Record<string, string>, options: { fetcherKey: string }) =>
    submits.push({ key: options.fetcherKey, fields, options }),
  useLocation: () => ({ pathname: "/calendar" }),
}));
vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ formClass: "", fieldLabel: "", formTrigger: "" }),
}));
vi.mock("~/components/ui/DateField", () => ({ DateField: () => null }));
vi.mock("~/components/ui/floating", () => ({ Select: () => null }));
vi.mock("~/calendar/components/WeekGrid", () => ({ EventDetailBody: () => null }));

let settleConfirm: (ok: boolean) => void = () => {};
const confirm = vi.fn(
  () =>
    new Promise<boolean>((resolve) => {
      settleConfirm = resolve;
    }),
);
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));

const { TimesheetEditPopover } = await import("~/calendar/components/timesheet");

const entry = {
  id: "t1",
  date: "2026-10-12T13:00:00.000Z",
  hours: 1,
  note: "Standup",
  source: "Manual",
  assignmentType: null,
  roleRefId: null,
  projectId: null,
  startTime: "2026-10-12T13:00:00.000Z",
  endTime: "2026-10-12T14:00:00.000Z",
  scheduledMeetingId: null,
  sourceEventId: null,
} as unknown as TimeEntryDTO;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

function mount(over: Partial<TimeEntryDTO> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(TimesheetEditPopover, {
        entry: { ...entry, ...over },
        startLocal: "2026-10-12T09:00",
        endLocal: "2026-10-12T10:00",
        myRoles: [],
        timezone: "America/New_York",
        onClose,
      }),
    ),
  );
}

const card = () => container.querySelector("[aria-label='Edit timesheet entry']")!;
const deleteButton = () =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Delete")!;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  submits.length = 0;
  onClose.mockClear();
});

describe("TimesheetEditPopover size", () => {
  it("grows with its content, capped only by the viewport, so an error message never adds a scrollbar", () => {
    mount();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.className).not.toMatch(/max-h-\[\d/);
    expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
  });
});

describe("TimesheetEditPopover delete", () => {
  it("steps aside while the confirm is up and comes back on cancel", async () => {
    mount();
    expect(card().className).not.toContain("invisible");

    await act(async () => {
      deleteButton().click();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(card().className).toContain("invisible");

    await act(async () => {
      settleConfirm(false);
    });
    expect(card().className).not.toContain("invisible");
  });

  it("sends the delete as a background write and closes once the confirm is accepted", async () => {
    mount();

    await act(async () => {
      deleteButton().click();
    });
    await act(async () => {
      settleConfirm(true);
    });

    expect(submits).toHaveLength(1);
    expect(submits[0]!.fields).toEqual({ intent: "delete-time-entry", id: "t1" });
    expect(submits[0]!.options).toMatchObject({ method: "post", action: "/calendar", navigate: false });
    expect(submits[0]!.key).toMatch(/^cal:bg:delete-time-entry:/);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and stays open when the confirm is declined", async () => {
    mount();

    await act(async () => {
      deleteButton().click();
    });
    await act(async () => {
      settleConfirm(false);
    });

    expect(submits).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("TimesheetEditPopover save", () => {
  it("is blocked without a role, so nothing is sent", async () => {
    mount();
    const save = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save")!;
    expect(save.disabled).toBe(true);
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(submits).toEqual([]);
  });

  it("sends the edit as a background write and closes at once", async () => {
    mount({ assignmentType: "Project" as TimeEntryDTO["assignmentType"], roleRefId: "r1" });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(submits).toHaveLength(1);
    expect(submits[0]!.key).toMatch(/^cal:bg:update-time-entry:/);
    expect(submits[0]!.fields).toMatchObject({
      intent: "update-time-entry",
      id: "t1",
      hours: "1",
      assignmentType: "Project",
      roleRefId: "r1",
      note: "Standup",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
