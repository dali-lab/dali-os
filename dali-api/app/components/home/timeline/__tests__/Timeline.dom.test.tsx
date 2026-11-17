// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import Timeline from "../Timeline";
import type { TimelineEvent, TimelineTerm } from "../term-timeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const base: TimelineEvent = {
  id: "e1",
  source: "alumni",
  title: "NYC alumni drinks",
  startsAt: "2026-11-20T00:00:00Z",
  hostName: "Ada Lovelace",
  location: null,
  goingCount: 2,
  classmates: 0,
  viewerGoing: false,
  href: null,
};
const term: TimelineTerm = { index: 7, term: "26F", startLabel: "Sep 14", projects: { count: 14, oldProject: null } };

function mount(events: TimelineEvent[], t: TimelineTerm | null = term) {
  const Stub = createRoutesStub([
    { path: "/", Component: () =>
        createElement(ToastProvider, null, createElement(Timeline, { events, term: t, tz: "America/New_York" })) },
  ]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Stub, { initialEntries: ["/"] })));
  return host;
}

describe("Timeline", () => {
  it("shows alumni events yellow and DALI events pink with a Going chip or an RSVP action", async () => {
    const el = mount([
      { ...base, viewerGoing: true },
      { ...base, id: "d1", source: "dali", title: "Lab open house", hostName: null, href: "/calendar/meeting/m1" },
      { ...base, id: "e2", title: "Other" },
    ]);
    await act(async () => {});
    const blocks = [...el.querySelectorAll("li span.size-11")];
    expect(blocks[0].className).toContain("bg-accent-yellow");
    expect(blocks[1].className).toContain("bg-accent-pink");
    expect(el.textContent).toContain("Going");
    expect(el.textContent).toContain("RSVP");
    expect(el.textContent).toContain("NOV");
    expect(el.querySelector('a[href="/calendar/meeting/m1"]')).not.toBeNull();
  });

  it("explains an empty list and links to hosting in Connect", async () => {
    const el = mount([]);
    await act(async () => {});
    expect(el.textContent).toContain("Nothing is coming up yet.");
    expect(el.textContent).toContain("Host an event in Connect");
  });

  it("draws ten term weeks with the current one marked", async () => {
    const el = mount([base]);
    await act(async () => {});
    const weeks = [...el.querySelectorAll("[data-week]")];
    expect(weeks).toHaveLength(10);
    expect(weeks[6].getAttribute("data-state")).toBe("current");
    expect(weeks[9].getAttribute("data-state")).toBe("last");
    expect(el.textContent).toContain("26F at DALI");
    expect(el.textContent).toContain("Week 7 of 10");
    expect(el.textContent).toContain("Sep 14");
    expect(el.textContent).toContain("14 teams are building this term.");
  });

  it("drops the term column between terms", async () => {
    const el = mount([base], null);
    await act(async () => {});
    expect(el.querySelector("[data-week]")).toBeNull();
    expect(el.textContent).toContain("Coming up");
  });
});
