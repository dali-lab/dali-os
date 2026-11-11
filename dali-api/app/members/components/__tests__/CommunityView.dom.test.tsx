// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, data } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import type { CommunityPerson } from "~/members/lib/community";
import type { CommunityEvent } from "~/members/lib/community.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/members/components/CommunityMap", () => ({
  CommunityMap: (props: {
    places: { key: string; faded?: boolean }[];
    home: { lat: number; lng: number } | null;
    onSelect: (keys: string[] | null) => void;
    onBoundsChange: (b: unknown) => void;
    onSelectEvent: (id: string) => void;
  }) =>
    createElement(
      "div",
      { "data-testid": "map" },
      createElement("span", { "data-testid": "faded" }, props.places.filter((p) => p.faded).map((p) => p.key).join(",")),
      createElement("button", { onClick: () => props.onBoundsChange({ south: 40, west: -75, north: 45, east: -70 }) }, "view New England"),
      createElement("button", { onClick: () => props.onSelect(["43.70,-72.29"]) }, "pin Hanover"),
      createElement("button", { onClick: () => props.onSelect(["43.70,-72.29", "42.36,-71.06"]) }, "pin New England"),
      createElement("span", { "data-testid": "home" }, JSON.stringify(props.home)),
      createElement("button", { onClick: () => props.onSelectEvent("ev1") }, "pin event"),
    ),
}));

const { CommunityView } = await import("../CommunityView");

const person = (id: string, over: Partial<CommunityPerson> = {}): CommunityPerson => ({
  id,
  name: `Ada ${id}`,
  photoUrl: null,
  classYear: 2019,
  isStudent: false,
  location: "Hanover, NH",
  lat: 43.7044,
  lng: -72.2887,
  currentJob: null,
  openToCoffeeChats: false,
  openToResumeReviews: false,
  activity: null,
  roles: [],
  projects: [],
  ...over,
});

const inDays = (d: number, h = 0) => new Date(Date.now() + d * 86_400_000 + h * 3_600_000).toISOString();
const event = (id: string, over: Partial<CommunityEvent> = {}): CommunityEvent => ({
  id,
  source: "alumni",
  title: `Event ${id}`,
  description: "Come hang out",
  startsAt: inDays(3),
  endsAt: inDays(3, 2),
  online: false,
  meetingUrl: null,
  placeName: "Cafe Nero",
  address: null,
  location: "Cafe Nero",
  lat: 43.7044,
  lng: -72.2887,
  audience: "alumni_and_students",
  notifyNearby: false,
  host: { id: "h1", name: "Hal Host", photoUrl: null, currentJob: "CTO at Co" },
  hostName: "Hal Host",
  goingCount: 4,
  knownGoingCount: 2,
  viewerGoing: false,
  attendees: [{ id: "p9", name: "Grace Going", photoUrl: null, reason: "Your class" }],
  canManage: false,
  href: null,
  ...over,
});

const PEOPLE = [
  person("today", { activity: "today", currentJob: "CTO at Co", openToCoffeeChats: true, classYear: 2020, projects: [{ id: "pr1", name: "Maps", term: "21F" }] }),
  person("week", { activity: "week", classYear: 2018 }),
  person("quiet", { classYear: 2017, isStudent: true }),
  person("boston", { location: "Boston, MA", lat: 42.36, lng: -71.06, classYear: 2020 }),
  person("london", { location: "London, UK", lat: 51.5, lng: -0.12, classYear: 2015 }),
];

const baseData = () => ({
  viewer: {
    id: "me",
    name: "Me",
    isAlumni: true,
    canHost: true,
    hasLocation: true,
    classYear: 2020,
    projectIds: [] as string[],
    lat: 43.7,
    lng: -72.29,
  },
  people: PEOPLE,
  unplaced: 0,
  filterOptions: { classYears: [{ value: 2020, count: 2 }], roles: [], projects: [] },
  events: [event("ev1"), event("on1", { online: true, location: "Online", lat: null, lng: null, title: "Online chat" })],
  tz: "America/New_York",
  openTo: { coffeeChats: false, resumeReviews: false },
});

let container: HTMLDivElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(
  overrides: Partial<ReturnType<typeof baseData>> = {},
  opts: { entry?: string; action?: () => unknown } = {},
) {
  const payload = { ...baseData(), ...overrides };
  const Stub = createRoutesStub([
    {
      path: "/community",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(DialogProvider, null, createElement(CommunityView, { data: payload as never })),
        ),
      action: opts.action ?? (() => ({ ok: true })),
    },
    { path: "/members/:id", Component: () => createElement("div", null, "profile") },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: [opts.entry ?? "/community"] }));
  });
}

const click = async (el: Element) =>
  act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const button = (name: string | RegExp) =>
  [...document.querySelectorAll("button")].find((b) =>
    typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? ""),
  ) as HTMLButtonElement;
const type = async (el: Element, value: string) =>
  act(async () => {
    const input = el as HTMLInputElement;
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const names = () => [...document.querySelectorAll('a[href^="/members/"]')].map((a) => a.textContent ?? "");
const text = () => document.body.textContent ?? "";

describe("people list", () => {
  it("lists everyone with counts on the tabs", async () => {
    await mount();
    expect(names()).toHaveLength(5);
    expect(text()).toContain("5 on the map");
    expect(document.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toContain("5");
  });

  it("narrows the list as the search and filters change, and clears them", async () => {
    await mount();
    await type(document.querySelector('input[aria-label="Search people"]')!, "boston");
    expect(names()).toHaveLength(1);
    await type(document.querySelector('input[aria-label="Search people"]')!, "");
    await click(button("Active this week"));
    expect(names()).toHaveLength(2);
    await click(button("Clear"));
    expect(names()).toHaveLength(5);
    expect(button("Clear")).toBeUndefined();
  });

  it("fades the pins that no longer match", async () => {
    await mount();
    await click(button("Active this week"));
    expect(document.querySelector('[data-testid="faded"]')!.textContent).toBe("42.36,-71.06,51.50,-0.12");
  });

  it("shows the activity marker for today and this week, and nothing when hidden", async () => {
    await mount();
    expect(text()).toContain("Active today");
    expect(text()).toContain("This week");
    const markers = [...document.querySelectorAll("[data-activity]")].map((m) => m.getAttribute("data-activity"));
    expect(markers).toEqual(["today", "week"]);
    const quietRow = [...document.querySelectorAll('a[href="/members/quiet"]')][0]!;
    expect(quietRow.querySelector("[data-activity]")).toBeNull();
  });

  it("marks students, coffee chats and the shared project", async () => {
    await mount({ viewer: { ...baseData().viewer, projectIds: ["pr1"] } });
    const quiet = document.querySelector('a[href="/members/quiet"]')!;
    expect(quiet.textContent).toContain("Student");
    const today = document.querySelector('a[href="/members/today"]')!;
    expect(today.querySelector('[aria-label="Open to coffee chats"]')).not.toBeNull();
    expect(today.textContent).toContain("Also on Maps, 21F");
    expect(today.textContent).toContain("CTO at Co · Hanover, NH");
  });
});

describe("list follows the map", () => {
  it("lists only people in view until the switch is turned off", async () => {
    await mount();
    await click(button("view New England"));
    expect(names()).toHaveLength(4);
    expect(text()).toContain("4 on the map");
    const toggle = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await click(toggle);
    expect(names()).toHaveLength(5);
    expect(text()).toContain("5 people");
  });
});

describe("a selected place", () => {
  it("shows the place head, events there first, then the people", async () => {
    await mount();
    await click(button("pin Hanover"));
    expect(text()).toContain("Hanover, NH");
    expect(text()).toContain("3 people, 1 from your class");
    expect(text()).toContain("Events here");
    expect(text()).toContain("Event ev1");
    expect(names()).toHaveLength(3);
    await click(button("All places"));
    expect(names()).toHaveLength(5);
    expect(text()).not.toContain("Events here");
  });

  it("a cluster of places lists everyone in them under the biggest place's name", async () => {
    await mount();
    await click(button("pin New England"));
    expect(text()).toContain("Hanover, NH and 1 more place");
    expect(text()).toContain("4 people, 2 from your class");
    expect(text()).toContain("Event ev1");
    expect(names()).toHaveLength(4);
    expect(names().join()).not.toContain("Ada london");
  });
});

describe("the map's home", () => {
  const home = () => JSON.parse(document.querySelector('[data-testid="home"]')!.textContent!);

  it("is the viewer's own location", async () => {
    await mount();
    expect(home()).toEqual({ lat: 43.7, lng: -72.29 });
  });

  it("is unset for a viewer with no location", async () => {
    await mount({ viewer: { ...baseData().viewer, hasLocation: false, lat: null as never, lng: null as never } });
    expect(home()).toBeNull();
  });
});

describe("hosting", () => {
  it("offers Host an event only to people who can host", async () => {
    await mount();
    expect(button("Host an event")).toBeDefined();
    await act(async () => root.unmount());
    container.remove();
    await mount({ viewer: { ...baseData().viewer, isAlumni: false, canHost: false } });
    expect(button("Host an event")).toBeUndefined();
    expect(button("I'm open to")).toBeUndefined();
  });

  it("shows validation messages and the server's reason inside the modal", async () => {
    await mount({}, { action: () => data({ ok: false, error: "We couldn't find that place. Check the name and address." }, { status: 400 }) });
    await click(button("Host an event"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(text()).toContain("It goes on the map when you post.");
    await click(button("Post event"));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Give the event a name.");

    const name = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    await type(name, "Mixer");
    await click(button("Post event"));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Pick a date.");
  });
});

describe("editing", () => {
  it("prefills the form and shows the server's reason inline", async () => {
    const reason = "We couldn't find that place. Check the name and address.";
    await mount(
      { events: [event("ev1", { canManage: true })] },
      { entry: "/community?event=ev1", action: () => data({ ok: false, error: reason }, { status: 400 }) },
    );
    await click(button("Edit"));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Edit event");
    expect((dialog.querySelector("input") as HTMLInputElement).value).toBe("Event ev1");
    await click(button("Save changes"));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe(reason);
  });
});

describe("events tab", () => {
  it("groups events on the map and online with going counts", async () => {
    await mount();
    await click(document.querySelector('[role="radio"]:not([aria-checked="true"])')!);
    expect(text()).toContain("1 on the map");
    expect(text()).toContain("Online");
    expect(text()).toContain("4 going, 2 you know");
    expect(button("RSVP")).toBeDefined();
  });

  it("opens the event panel from a deep link and lets the host manage it", async () => {
    await mount({ events: [event("ev1", { canManage: true, viewerGoing: true })] }, { entry: "/community?event=ev1" });
    const panel = document.querySelector('aside[aria-label="Event"]')!;
    expect(panel.textContent).toContain("Event ev1");
    expect(panel.textContent).toContain("Come hang out");
    expect(panel.textContent).toContain("Hal Host");
    expect(panel.textContent).toContain("4 going");
    expect(panel.textContent).toContain("Grace Going");
    expect(panel.textContent).toContain("You're going");
    expect(panel.querySelector('a[href="/community/events/ev1/calendar.ics"]')).not.toBeNull();
    expect(button("Can't go")).toBeDefined();
    expect(button("Edit")).toBeDefined();
    expect(button("Cancel event")).toBeDefined();
  });

  it("offers Going to someone who has not RSVPed, and no manage buttons", async () => {
    await mount({}, { entry: "/community?event=ev1" });
    expect(button("Going")).toBeDefined();
    expect(button("Edit")).toBeUndefined();
    expect(button("Cancel event")).toBeUndefined();
    expect(document.querySelector('a[href$="calendar.ics"]')).toBeNull();
  });

  it("opens an event pin in the panel and closes it again", async () => {
    await mount();
    await click(button("pin event"));
    expect(document.querySelector('aside[aria-label="Event"]')).not.toBeNull();
    await click(document.querySelector('button[aria-label="Close event"]')!);
    expect(document.querySelector('aside[aria-label="Event"]')).toBeNull();
  });
});
