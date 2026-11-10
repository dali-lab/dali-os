// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router", () => ({ Link: () => null }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock("~/hiring/components/InterviewSlotPicker", () => ({ InterviewSlotPicker: () => null }));

const { InterviewScheduledView } = await import("~/hiring/components/ApplicationTracker");

const hours = (n: number) => new Date(Date.now() + n * 60 * 60_000).toISOString();

let root: Root;
let host: HTMLDivElement;

async function mount(interview: { startTime: string; rescheduleBy: string; cancelBy: string }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(InterviewScheduledView, {
        domainApp: {
          id: "da1",
          domainId: "dev",
          domainName: "Developer",
          inferredStatus: "InterviewScheduled",
          interview: { id: "iv1", endTime: interview.startTime, status: "Scheduled", ...interview },
        },
        cycleId: "cycle1",
        cycleName: "Fall 2026",
        slotDurationMinutes: 30,
        viewerTimeZone: "America/New_York",
        onCancelled: () => {},
        onRescheduled: () => {},
      }),
    );
  });
}

const buttons = () => Array.from(host.querySelectorAll("button")).map((b) => b.textContent);

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("InterviewScheduledView", () => {
  it("offers both actions while the reschedule window is open", async () => {
    await mount({ startTime: hours(48), rescheduleBy: hours(36), cancelBy: hours(48) });
    expect(buttons()).toEqual(["Reschedule", "Cancel Interview"]);
    expect(host.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("drops Reschedule past the cutoff and points to the team before anyone picks a time", async () => {
    await mount({ startTime: hours(6), rescheduleBy: hours(-6), cancelBy: hours(6) });
    expect(buttons()).toEqual(["Cancel Interview"]);
    expect(host.textContent).toContain("too close to your interview");
  });

  it("offers no actions once the interview has started", async () => {
    await mount({ startTime: hours(-1), rescheduleBy: hours(-13), cancelBy: hours(-1) });
    expect(buttons()).toEqual([]);
    expect(host.textContent).toContain("Your interview time has passed");
  });
});
