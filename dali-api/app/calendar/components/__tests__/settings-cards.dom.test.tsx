// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WhDay } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submit = vi.fn();
let fetcherState: { state: string; formData?: FormData } = { state: "idle" };
vi.mock("react-router", () => ({
  useFetcher: () => ({ data: undefined, formData: undefined, ...fetcherState, submit, Form: "form" }),
}));
vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ card: "", cardPad: "", heading: "", headingIcon: "" }),
}));

const { WorkingHoursCard } = await import("~/calendar/components/settings-cards");

let container: HTMLDivElement;
let root: Root;

const day = (dayOfWeek: number, segments: WhDay["segments"]): WhDay => ({ dayOfWeek, segments });
const seg = { startMinute: 540, endMinute: 1020, location: "InPerson" } as unknown as WhDay["segments"][number];
const week = [0, 1, 2, 3, 4, 5, 6].map((d) => day(d, d >= 1 && d <= 5 ? [seg] : []));

beforeEach(async () => {
  submit.mockReset();
  fetcherState = { state: "idle" };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(WorkingHoursCard, { workingHours: week, hasPersisted: true })));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("WorkingHoursCard day edits", () => {
  it("saves only the day that changed", async () => {
    const tuesday = container.querySelector<HTMLButtonElement>("button[aria-label='Tue enabled']")!;
    await act(async () => tuesday.click());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      { intent: "set-working-segments", dayOfWeek: "2", segments: "[]" },
      { method: "post" },
    );
  });
});

describe("WorkingHoursCard reset", () => {
  const custom = [0, 1, 2, 3, 4, 5, 6].map((d) =>
    day(d, d >= 1 && d <= 5 ? [{ ...seg, startMinute: 600, endMinute: 660 } as typeof seg] : []),
  );
  const times = () =>
    Array.from(container.querySelectorAll<HTMLInputElement>("input[aria-label='Mon segment 1 start']")).map((i) => i.value);

  async function render() {
    await act(async () => root.render(createElement(WorkingHoursCard, { workingHours: custom, hasPersisted: true })));
  }

  it("draws the saved hours while nothing is resetting", async () => {
    await render();
    expect(times()).toEqual(["10:00 AM"]);
  });

  it("draws the default hours as soon as a reset is sent", async () => {
    const fd = new FormData();
    fd.set("intent", "seed-working-hours");
    fetcherState = { state: "submitting", formData: fd };
    await render();
    expect(times()).toEqual(["09:00 AM"]);
  });
});
