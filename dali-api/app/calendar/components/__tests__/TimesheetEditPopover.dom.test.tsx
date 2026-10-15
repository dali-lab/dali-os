// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TimeEntryDTO } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router", () => ({
  useRevalidator: () => ({ revalidate: vi.fn() }),
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

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(TimesheetEditPopover, {
        entry,
        startLocal: "2026-10-12T09:00",
        endLocal: "2026-10-12T10:00",
        myRoles: [],
        timezone: "America/New_York",
        onClose: vi.fn(),
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
  vi.stubGlobal("fetch", undefined);
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

  it("deletes the entry once the confirm is accepted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    mount();

    await act(async () => {
      deleteButton().click();
    });
    await act(async () => {
      settleConfirm(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("intent")).toBe("delete-time-entry");
    expect(body.get("id")).toBe("t1");
  });
});
