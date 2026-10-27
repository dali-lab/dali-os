// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { RailUpcoming, UPCOMING_REFRESH_MS, useUpcomingMeetings } from "~/components/shell/RailUpcoming";
import type { UpcomingMeeting } from "~/lib/upcoming-meetings.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(node: () => React.ReactElement) {
  const Stub = createRoutesStub([{ path: "*", Component: node }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const NOW = new Date("2026-10-13T16:00:00Z"); // noon Tuesday in New York, the lab zone
const meetings: UpcomingMeeting[] = [
  { meetingId: "m1", title: "Dev Mentors Meeting", startsAt: "2026-10-13T18:00:00Z", href: "/documents/n1" },
  { meetingId: "m2", title: "", startsAt: "2026-10-15T14:00:00Z", href: "/whiteboard/n2" },
];

describe("RailUpcoming", () => {
  it("lists each meeting with its time today or its weekday", async () => {
    await render(() => createElement(RailUpcoming, { meetings, tabClickProps: () => ({}), now: NOW }));
    const rows = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(rows).toEqual(["Dev Mentors Meeting2:00 PM", "UntitledThu"]);
    expect(container.querySelector("h2")!.textContent).toBe("Upcoming");
  });

  it("opens a meeting's notes as a tab", async () => {
    const tabClickProps = vi.fn(() => ({}));
    await render(() => createElement(RailUpcoming, { meetings, tabClickProps, now: NOW }));
    expect(tabClickProps).toHaveBeenCalledWith({ url: "/documents/n1", label: "Dev Mentors Meeting" });
    expect(tabClickProps).toHaveBeenCalledWith({ url: "/whiteboard/n2", label: "" });
  });
});

describe("useUpcomingMeetings", () => {
  let seen: UpcomingMeeting[] = [];
  const Probe = ({ enabled }: { enabled: boolean }) => {
    seen = useUpcomingMeetings(enabled);
    return null;
  };
  const respond = (list: UpcomingMeeting[]) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ meetings: list })));

  beforeEach(() => {
    seen = [];
  });

  it("loads the list once on mount", async () => {
    const fetchSpy = respond(meetings);
    await render(() => createElement(Probe, { enabled: true }));
    await act(async () => {});
    expect(fetchSpy).toHaveBeenCalledWith("/api/upcoming-meetings", { credentials: "include" });
    expect(seen.map((m) => m.meetingId)).toEqual(["m1", "m2"]);
  });

  it("never asks when disabled", async () => {
    const fetchSpy = respond(meetings);
    await render(() => createElement(Probe, { enabled: false }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it("refreshes on its interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fetchSpy = respond(meetings);
    await render(() => createElement(Probe, { enabled: true }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(UPCOMING_REFRESH_MS);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps the last list when a refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fetchSpy = respond(meetings);
    await render(() => createElement(Probe, { enabled: true }));
    await act(async () => {});
    fetchSpy.mockResolvedValue(new Response("nope", { status: 500 }));
    await act(async () => {
      vi.advanceTimersByTime(UPCOMING_REFRESH_MS);
    });
    expect(seen.map((m) => m.meetingId)).toEqual(["m1", "m2"]);
  });
});
