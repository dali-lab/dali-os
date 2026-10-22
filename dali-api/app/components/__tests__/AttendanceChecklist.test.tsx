// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(ui));
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const attendees: AttendanceRow[] = [{ userId: "u1", name: "Alex Chen", present: false }];

async function toggleFirstCheckbox() {
  const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
  await act(async () => {
    checkbox.click();
  });
}

describe("AttendanceChecklist endpoint prop", () => {
  it("defaults to the scheduled-meetings attendance route", async () => {
    mount(
      createElement(AttendanceChecklist, {
        meetingId: "m1",
        occurrenceStart: "2026-10-05T14:00:00.000Z",
        meetingLabel: "Standup",
        canEdit: true,
        plain: true,
        attendees,
      }),
    );
    await toggleFirstCheckbox();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/scheduled-meetings/m1/attendance");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(init.body)).toEqual({
      userId: "u1",
      present: true,
      occurrence: "2026-10-05T14:00:00.000Z",
    });
  });

  it("POSTs to a custom endpoint when given one, keeping the {userId, present, occurrence} body", async () => {
    mount(
      createElement(AttendanceChecklist, {
        meetingId: "evt1",
        occurrenceStart: "2026-10-14T20:00:00.000Z",
        meetingLabel: "Application help hour",
        canEdit: true,
        plain: true,
        attendees,
        endpoint: "/api/hiring/events/evt1",
      }),
    );
    await toggleFirstCheckbox();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/hiring/events/evt1");
    expect(JSON.parse(init.body)).toEqual({
      userId: "u1",
      present: true,
      occurrence: "2026-10-14T20:00:00.000Z",
    });
  });

  it("reverts the optimistic toggle when the custom endpoint fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) });
    mount(
      createElement(AttendanceChecklist, {
        meetingId: "evt1",
        occurrenceStart: "2026-10-14T20:00:00.000Z",
        meetingLabel: "Application help hour",
        canEdit: true,
        plain: true,
        attendees,
        endpoint: "/api/hiring/events/evt1",
      }),
    );
    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    expect(checkbox.checked).toBe(false);
  });
});

describe("AttendanceChecklist onRowsChange", () => {
  it("reports the rows again after someone is checked off", async () => {
    const onRowsChange = vi.fn();
    mount(
      createElement(AttendanceChecklist, {
        meetingId: "m1",
        occurrenceStart: "2026-10-05T14:00:00.000Z",
        meetingLabel: "Standup",
        canEdit: true,
        plain: true,
        attendees,
        onRowsChange,
      }),
    );
    expect(onRowsChange).toHaveBeenLastCalledWith([expect.objectContaining({ userId: "u1", present: false })]);
    await toggleFirstCheckbox();
    expect(onRowsChange).toHaveBeenLastCalledWith([expect.objectContaining({ userId: "u1", present: true })]);
  });
});
