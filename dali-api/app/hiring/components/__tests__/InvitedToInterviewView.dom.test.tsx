// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router", () => ({ Link: () => null }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock("~/hiring/components/InterviewSlotPicker", () => ({
  InterviewSlotPicker: ({ groups }: { groups: { slots: unknown[] }[] }) =>
    createElement("div", { "data-testid": "picker" }, `${groups.reduce((n, g) => n + g.slots.length, 0)} slots`),
}));

const { InvitedToInterviewView } = await import("~/hiring/components/ApplicationTracker");

const domainApp = { id: "da1", domainId: "dev", domainName: "Developer", status: "InvitedToInterview" } as any;

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(InvitedToInterviewView, {
        domainApp,
        cycleId: "cycle1",
        cycleName: "Fall 2026",
        viewerTimeZone: "America/New_York",
        onBooked: () => {},
      }),
    );
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("InvitedToInterviewView", () => {
  it("lists the slots the API returns", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ startTime: "2030-04-15T13:00:00.000Z", endTime: "2030-04-15T13:30:00.000Z" }],
    });
    await mount();
    expect(host.querySelector("[data-testid=picker]")?.textContent).toBe("1 slots");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/hiring/cycles/cycle1/available-slots?domainId=dev&mode=in-person");
  });

  it("says no slots are available yet when the API returns none", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    await mount();
    expect(host.textContent).toContain("No interview slots are available yet");
    expect(host.textContent).not.toContain("—");
  });

  it("does not pass a failed request off as an empty slot list", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
    await mount();
    expect(host.textContent).toContain("Interview times could not be loaded");
    expect(host.textContent).not.toContain("No interview slots are available yet");
  });
});
