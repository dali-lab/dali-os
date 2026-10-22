// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WhDay } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submit = vi.fn();
vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, formData: undefined, submit, Form: "form" }),
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
