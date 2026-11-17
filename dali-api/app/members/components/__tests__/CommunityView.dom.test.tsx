// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, data } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import type { CommunityPerson } from "~/members/lib/community";
import type { CommunityEvent, CommunityFilterOptions } from "~/members/lib/community.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/members/components/CommunityMap", () => ({
  CommunityMap: (props: {
    places: { key: string; faded?: boolean }[];
    home: { lat: number; lng: number } | null;
    onSelect: (keys: string[] | null) => void;
    onBoundsChange: (b: unknown) => void;
    onSelectEvent: (id: string) => void;
    fitRequest?: { keys: string[] } | null;
    dimPeople?: boolean;
  }) =>
    createElement(
      "div",
      { "data-testid": "map" },
      createElement("span", { "data-testid": "faded" }, props.places.filter((p) => p.faded).map((p) => p.key).join(",")),
      createElement("button", { onClick: () => props.onBoundsChange({ south: 40, west: -75, north: 45, east: -70 }) }, "view New England"),
      createElement("button", { onClick: () => props.onSelect(["43.70,-72.29"]) }, "pin Hanover"),
      createElement("button", { onClick: () => props.onSelect(["43.70,-72.29", "42.36,-71.06"]) }, "pin New England"),
      createElement("span", { "data-testid": "home" }, JSON.stringify(props.home)),
      createElement("span", { "data-testid": "fit" }, props.fitRequest ? props.fitRequest.keys.join(",") : ""),
      createElement("span", { "data-testid": "dim" }, String(Boolean(props.dimPeople))),
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
  filterOptions: {
    classYears: [{ value: 2020, count: 2 }],
    roles: [],
    projects: [],
  } as CommunityFilterOptions,
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
const radio = (label: string) =>
  [...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.includes(label)) as HTMLElement;
const chip = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Clear ${name}"]`);
const filtersButton = () => button(/^Filters/);
const openFilters = async () => click(filtersButton());
const searchBox = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const key = async (el: Element, k: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
const names = () => [...document.querySelectorAll('a[href^="/members/"]')].map((a) => a.textContent ?? "");
const text = () => document.body.textContent ?? "";

describe("people list", () => {
  it("lists everyone in view with counts on the tabs", async () => {
    await mount();
    expect(names()).toHaveLength(5);
    expect(text()).toContain("5 in this view");
    expect(text()).not.toContain("on the map");
    expect(radio("People").getAttribute("aria-checked")).toBe("true");
    expect(radio("People").textContent).toContain("5");
  });

  it("narrows the list as the search and filters change, and resets them", async () => {
    await mount();
    await type(searchBox(), "boston");
    expect(names()).toHaveLength(1);
    await type(searchBox(), "");
    await openFilters();
    await click(document.querySelector('input[role="switch"]')!);
    expect(names()).toHaveLength(2);
    await click(button("Reset"));
    expect(names()).toHaveLength(5);
    expect(button("Reset")).toBeUndefined();
  });

  it("fades the pins that no longer match", async () => {
    await mount();
    await openFilters();
    await click(document.querySelector('input[role="switch"]')!);
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

  it("shows only people on the People tab: no next-event card", async () => {
    await mount();
    expect(text()).not.toContain("Next event");
    expect(text()).not.toContain("Events here");
  });
});

describe("filters button", () => {
  it("sits beside the search box with no count until a filter is on", async () => {
    await mount();
    expect(filtersButton().textContent).toBe("Filters");
    expect(button("Clear")).toBeUndefined();
    expect(document.querySelector('[aria-label="Open to coffee chats"]')).not.toBeNull();
  });

  it("counts active filters in a badge and lists the people filters without a role tooltip", async () => {
    await mount({
      filterOptions: {
        classYears: [{ value: 2020, count: 2 }],
        roles: [{ value: "Design", count: 1 }],
        projects: [{ id: "pr1", name: "Maps", term: "21F", count: 1 }],
      },
    });
    await openFilters();
    const panel = document.querySelector('[aria-label="Filters"]')!;
    for (const label of ["Who", "Class", "Role at DALI", "Project", "Open to", "Active this week"]) {
      expect(panel.textContent).toContain(label);
    }
    expect(document.querySelector('[aria-label="About role at DALI"]')).toBeNull();
    expect(text()).not.toContain("From their DALI terms");

    await click(button("Alumni"));
    await click(button("2020"));
    expect(filtersButton().textContent).toBe("Filters2");
    expect(names()).toHaveLength(2);
    await click(button("Coffee chats"));
    expect(filtersButton().textContent).toBe("Filters3");
    await click(button("Reset"));
    expect(filtersButton().textContent).toBe("Filters");
    expect(names()).toHaveLength(5);
  });

  it("has its own event filters on the Events tab", async () => {
    await mount();
    await click(radio("Events"));
    await openFilters();
    const panel = document.querySelector('[aria-label="Filters"]')!;
    for (const label of ["Date window", "Alumni and DALI", "Alumni events", "DALI events", "In person and online", "In person", "Online"]) {
      expect(panel.textContent).toContain(label);
    }
    await click(button("DALI events"));
    expect(filtersButton().textContent).toBe("Filters1");
    expect(text()).toContain("No upcoming events.");
    await click(button("Reset"));
    expect(filtersButton().textContent).toBe("Filters");
    expect(text()).toContain("Event ev1");
  });
});

describe("the list always follows the map", () => {
  it("lists only people in view and has no switch to turn that off", async () => {
    await mount();
    await click(button("view New England"));
    expect(names()).toHaveLength(4);
    expect(text()).toContain("4 in this view");
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(text()).not.toContain("List what's on the map");
  });
});

describe("a selected place", () => {
  it("scopes both tabs and their counts to the place", async () => {
    await mount();
    await click(button("pin Hanover"));
    expect(names()).toHaveLength(3);
    expect(radio("People").textContent).toContain("3");
    expect(radio("Events").textContent).toContain("1");
    expect(text()).toContain("3 people, 1 from your class");

    await click(radio("Events"));
    expect(text()).toContain("1 upcoming event. 3 people are based here.");
    expect(text()).toContain("Event ev1");
    expect(text()).not.toContain("Online chat");
    expect(text()).not.toContain("Online");
    expect(radio("People").textContent).toContain("3");
    expect(radio("Events").textContent).toContain("1");
  });

  it("shows a place with no events as such on the Events tab", async () => {
    await mount();
    await click(button("pin New England"));
    await click(radio("Events"));
    expect(text()).toContain("Hanover, NH and 1 more place");
    expect(text()).toContain("Event ev1");
    await click(chip("Hanover, NH and 1 more place")!);
    expect(text()).toContain("Online chat");
  });

  it("shows the place as a chip in the search box and the bare placeholders", async () => {
    await mount();
    expect(searchBox().placeholder).toBe("Name, company, or city");
    await click(button("pin Hanover"));
    expect(chip("Hanover, NH")).toBeDefined();
    expect(text()).not.toContain("All places");
    expect(searchBox().placeholder).toBe("Name or company");
    await click(radio("Events"));
    expect(searchBox().placeholder).toBe("Event or host");
  });

  it("clearing the chip brings everyone back and fits the map to all places", async () => {
    await mount();
    await click(button("pin Hanover"));
    await click(chip("Hanover, NH")!);
    expect(chip("Hanover, NH")).toBeNull();
    expect(names()).toHaveLength(5);
    expect(document.querySelector('[data-testid="fit"]')!.textContent).toBe("43.70,-72.29,42.36,-71.06,51.50,-0.12");
  });

  it("a cluster of places lists everyone in them under the biggest place's name", async () => {
    await mount();
    await click(button("pin New England"));
    expect(text()).toContain("Hanover, NH and 1 more place");
    expect(text()).toContain("4 people, 2 from your class");
    expect(names()).toHaveLength(4);
    expect(names().join()).not.toContain("Ada london");
  });
});

describe("place suggestions", () => {
  const CAMBRIDGE = person("cam", { location: "Cambridge, MA", lat: 42.37, lng: -71.11 });
  const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");

  it("stays closed under two characters and lists matching places with counts", async () => {
    await mount();
    await type(searchBox(), "b");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await type(searchBox(), "bos");
    expect(options()[0]).toBe("Boston, MA1 person");
    expect(text()).toContain('Press Enter to search names, jobs and cities for "bos"');
  });

  it("offers an area row when other places are within 40 km, and picking it selects them all", async () => {
    await mount({ people: [...PEOPLE, CAMBRIDGE] });
    await type(searchBox(), "boston");
    expect(options()[0]).toBe("Boston, MA areaCambridge, MA2 people");
    await click(document.querySelector('[role="option"]')!);
    expect(chip("Boston, MA")).toBeDefined();
    expect(document.querySelector('[data-testid="fit"]')!.textContent).toBe("42.36,-71.06,42.37,-71.11");
    expect(names()).toHaveLength(2);
    expect(searchBox().value).toBe("");
  });

  it("suggests people only on the People tab", async () => {
    await mount();
    await type(searchBox(), "Ada today");
    expect(options()).toHaveLength(1);
    expect(options()[0]).toContain("Ada todayCTO at Co · Hanover, NH");
    await click(radio("Events"));
    await type(searchBox(), "Ada today");
    expect(options()).toEqual([]);
  });

  it("moves with the arrow keys, picks with Enter and closes on Escape", async () => {
    await mount();
    await type(searchBox(), "hanover");
    await key(searchBox(), "ArrowDown");
    expect(document.querySelector('[role="option"][aria-selected="true"]')!.textContent).toContain("Hanover, NH");
    await key(searchBox(), "Enter");
    expect(chip("Hanover, NH")).toBeDefined();

    await type(searchBox(), "boston");
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    await key(searchBox(), "Escape");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("Enter with nothing highlighted keeps the plain text filter", async () => {
    await mount();
    await type(searchBox(), "boston");
    await key(searchBox(), "Enter");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(chip("Boston, MA")).toBeNull();
    expect(names()).toHaveLength(1);
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
  it("puts Host an event first in the Events tab, not in the header or the People tab", async () => {
    await mount();
    expect(button("Host an event")).toBeUndefined();
    await click(radio("Events"));
    const host = button(/Host an event/)!;
    expect(host.textContent).toContain("Drinks, a talk, a study night. It goes on the map.");
    expect(host.className).toContain("border-dashed");
    expect(host.previousElementSibling!.querySelector('input[role="combobox"]')).not.toBeNull();
  });

  it("offers Host an event only to people who can host", async () => {
    await mount({ viewer: { ...baseData().viewer, isAlumni: false, canHost: false } });
    await click(radio("Events"));
    expect(button(/Host an event/)).toBeUndefined();
    expect(button(/I'm open to/)).toBeUndefined();
  });

  it("shows validation messages and the server's reason inside the modal", async () => {
    await mount({}, { action: () => data({ ok: false, error: "We couldn't find that place. Check the name and address." }, { status: 400 }) });
    await click(radio("Events"));
    await click(button(/Host an event/));
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
    expect(text()).toContain("1 in this view");
    expect(text()).toContain("Online");
    expect(document.querySelector('[data-testid="dim"]')!.textContent).toBe("true");
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

describe("I'm open to", () => {
  const pill = () => button(/I'm open to/)!;

  it("is a pill on the map for alumni, summarising what is on", async () => {
    await mount();
    expect(pill().textContent).toBe("I'm open toNothing yet");
    expect(document.querySelector('[data-testid="map"]')!.closest(".relative")!.contains(pill())).toBe(true);
  });

  it.each([
    [{ coffeeChats: true, resumeReviews: false }, "Coffee chats"],
    [{ coffeeChats: false, resumeReviews: true }, "Resume reviews"],
    [{ coffeeChats: true, resumeReviews: true }, "Coffee chats, resume reviews"],
  ])("reads %j as %s", async (openTo, summary) => {
    await mount({ openTo });
    expect(pill().textContent).toBe(`I'm open to${summary}`);
  });

  it("opens a panel with the anonymity note and a switch per option that saves", async () => {
    const action = vi.fn(() => ({ ok: true }));
    await mount({}, { action });
    await click(pill());
    const panel = document.querySelector('[aria-label="I\'m open to"]')!;
    expect(panel.textContent).toContain("Others can ask you for these from your profile. Requests stay anonymous until you say yes.");
    const switches = [...panel.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
    expect(switches).toHaveLength(2);
    expect(panel.textContent).toContain("Coffee chats");
    expect(panel.textContent).toContain("Resume reviews");
    await click(switches[0]);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("is not on the map for students", async () => {
    await mount({ viewer: { ...baseData().viewer, isAlumni: false, canHost: false } });
    expect(pill()).toBeUndefined();
  });

  it("moves the legend to the top left", async () => {
    await mount();
    const legend = [...document.querySelectorAll("div")].find((d) => d.textContent === "PeopleAlumni eventsDALI events")!;
    expect(legend.className).toContain("top-3");
    expect(legend.className).toContain("left-3");
  });
});
