// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CommunityPerson } from "~/members/lib/community";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = () => void;

const fake = vi.hoisted(() => {
  const state = {
    maps: [] as FakeMap[],
    markers: [] as FakeMarker[],
    workerUrl: null as string | null,
    bounds: { south: 10, west: 170, north: 50, east: 200 },
  };

  class FakeMap {
    handlers = new Map<string, Handler[]>();
    container: HTMLElement;
    options: Record<string, unknown>;
    styles: string[] = [];
    fits: { bounds: FakeBounds; options: Record<string, unknown> }[] = [];
    jumps: unknown[] = [];
    removed = false;
    zoom = 1;
    touchZoomRotate = { disableRotation: vi.fn() };
    keyboard = { disableRotation: vi.fn() };
    constructor(options: Record<string, unknown> & { container: HTMLElement; style: string }) {
      this.options = options;
      this.container = options.container;
      this.styles.push(options.style);
      state.maps.push(this);
    }
    on(type: string, fn: Handler) {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
      return this;
    }
    fire(type: string) {
      for (const fn of this.handlers.get(type) ?? []) fn();
    }
    getZoom() {
      return this.zoom;
    }
    getContainer() {
      return this.container;
    }
    getBounds() {
      const b = state.bounds;
      return { getSouth: () => b.south, getWest: () => b.west, getNorth: () => b.north, getEast: () => b.east };
    }
    setMinZoom = vi.fn();
    setStyle(style: string) {
      this.styles.push(style);
    }
    fitBounds(bounds: FakeBounds, options: Record<string, unknown>) {
      this.fits.push({ bounds, options });
    }
    jumpTo(options: unknown) {
      this.jumps.push(options);
    }
    remove() {
      this.removed = true;
    }
  }

  class FakeMarker {
    element: HTMLElement;
    options: Record<string, unknown>;
    lngLat: [number, number] | null = null;
    removed = false;
    constructor(options: { element: HTMLElement } & Record<string, unknown>) {
      this.options = options;
      this.element = options.element;
      state.markers.push(this);
    }
    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }
    addTo(map: FakeMap) {
      map.container.append(this.element);
      return this;
    }
    remove() {
      this.removed = true;
      this.element.remove();
    }
  }

  class FakeBounds {
    points: [number, number][] = [];
    extend(p: [number, number]) {
      this.points.push(p);
      return this;
    }
  }

  return {
    state,
    module: {
      Map: FakeMap,
      Marker: FakeMarker,
      LngLatBounds: FakeBounds,
      setWorkerUrl: (url: string) => {
        state.workerUrl = url;
      },
    },
  };
});

type FakeMap = InstanceType<typeof fake.module.Map>;
type FakeMarker = InstanceType<typeof fake.module.Marker>;

vi.mock("maplibre-gl", () => fake.module);
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?url", () => ({ default: "/assets/maplibre-worker.mjs" }));

const { CommunityMap, mapStyleUrl } = await import("../CommunityMap");
type Props = Parameters<typeof CommunityMap>[0];

const person = (id: string, over: Partial<CommunityPerson> = {}): CommunityPerson => ({
  id,
  name: `Ada ${id}`,
  photoUrl: null,
  classYear: 2019,
  isStudent: false,
  location: "Hanover, NH",
  lat: 43.7,
  lng: -72.29,
  currentJob: null,
  openToCoffeeChats: false,
  openToResumeReviews: false,
  activity: null,
  roles: [],
  projects: [],
  ...over,
});

const place = (key: string, lng: number, lat: number, people = [person(key)]) => ({
  key,
  label: `Place ${key}`,
  lat,
  lng,
  people,
  alumniCount: people.length,
  studentCount: 0,
});

const HANOVER = place("hanover", -72.29, 43.7);
const LONDON = place("london", -0.13, 51.5);
const EVENT = {
  id: "ev1",
  source: "alumni" as const,
  title: "Coffee",
  startsAt: "2026-11-20T15:00:00.000Z",
  lat: 40.7,
  lng: -74,
};

let root: Root;
let host: HTMLDivElement;
let props: Props;
let height = 600;

const live = () => fake.state.markers.filter((m) => !m.removed);
const pinFor = (text: string) => live().find((m) => m.element.textContent?.includes(text))!;
const theMap = () => fake.state.maps[0];

async function render(over: Partial<Props> = {}) {
  props = { ...props, ...over };
  await act(async () => {
    root.render(createElement(CommunityMap, props));
  });
}

async function mount(over: Partial<Props> = {}) {
  props = {
    places: [HANOVER, LONDON],
    events: [EVENT],
    tz: "America/New_York",
    home: null,
    selectedKeys: null,
    selectedEventId: null,
    onSelect: vi.fn(),
    onSelectEvent: vi.fn(),
    onBoundsChange: vi.fn(),
    className: "h-full",
    ...over,
  };
  await render();
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

beforeEach(() => {
  fake.state.maps.length = 0;
  fake.state.markers.length = 0;
  fake.state.workerUrl = null;
  height = 600;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  document.documentElement.classList.remove("light");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CommunityMap", () => {
  it("loads MapLibre with the bundled worker, the dark style, and rotation off", async () => {
    await mount();
    expect(fake.state.workerUrl).toBe("/assets/maplibre-worker.mjs");
    expect(theMap().styles).toEqual(["https://tiles.openfreemap.org/styles/dark"]);
    expect(theMap().options).toMatchObject({ dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0 });
    expect(theMap().touchZoomRotate.disableRotation).toHaveBeenCalled();
    expect(theMap().keyboard.disableRotation).toHaveBeenCalled();
  });

  it("starts on the light style in light mode and follows theme switches", async () => {
    document.documentElement.classList.add("light");
    await mount();
    expect(theMap().styles).toEqual([mapStyleUrl(false)]);

    await act(async () => {
      document.documentElement.classList.remove("light");
      await Promise.resolve();
    });
    expect(theMap().styles).toEqual([mapStyleUrl(false), mapStyleUrl(true)]);

    await act(async () => {
      document.documentElement.classList.add("other");
      await Promise.resolve();
    });
    expect(theMap().styles).toHaveLength(2);
  });

  it("puts one pin on each place and each located event", async () => {
    await mount({ events: [EVENT, { ...EVENT, id: "online", lat: null, lng: null }] });
    expect(live()).toHaveLength(3);
    expect(pinFor("Ada hanover").lngLat).toEqual([-72.29, 43.7]);
    expect(pinFor("NOV").lngLat).toEqual([-74, 40.7]);
  });

  it("anchors place pins on the first photo and event pins above their point", async () => {
    await mount();
    expect(pinFor("Ada hanover").options).toMatchObject({ anchor: "top-left", offset: [-15, -15] });
    expect(pinFor("NOV").options).toMatchObject({ anchor: "top-left", offset: [-22, -66] });
  });

  it("labels a shared place with the first name and a count, as text not markup", async () => {
    const people = [person("a", { name: "<b>Bold</b>" }), person("b"), person("c"), person("d")];
    await mount({ places: [place("nyc", -74, 40.7, people)], events: [] });
    const pin = live()[0].element;
    expect(pin.textContent).toContain("<b>Bold</b> +3");
    expect(pin.querySelector("b")).toBeNull();
    expect(pin.querySelectorAll("span, img").length).toBe(4);
  });

  it("selecting a place rebuilds only that pin", async () => {
    await mount();
    const london = pinFor("Ada london");
    const event = pinFor("NOV");
    await render({ selectedKeys: ["hanover"] });
    expect(live()).toHaveLength(3);
    expect(pinFor("Ada london")).toBe(london);
    expect(pinFor("NOV")).toBe(event);
    expect(pinFor("Ada hanover").element.style.zIndex).toBe("3");
  });

  it("drops pins for places that leave the map", async () => {
    await mount();
    const hanover = pinFor("Ada hanover");
    await render({ places: [HANOVER] });
    expect(live()).toHaveLength(2);
    expect(pinFor("Ada hanover")).toBe(hanover);
    expect(theMap().container.textContent).not.toContain("Ada london");
  });

  it("clicking a pin selects it and clicking the selected pin clears it", async () => {
    await mount();
    (pinFor("Ada hanover").element.firstElementChild as HTMLElement).click();
    expect(props.onSelect).toHaveBeenLastCalledWith(["hanover"]);
    expect(theMap().fits).toHaveLength(1);

    await render({ selectedKeys: ["hanover"] });
    (pinFor("Ada hanover").element.firstElementChild as HTMLElement).click();
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
  });

  it("clicking an event pin opens the event", async () => {
    await mount();
    (pinFor("NOV").element.firstElementChild as HTMLElement).click();
    expect(props.onSelectEvent).toHaveBeenCalledWith("ev1");
  });

  it("raises a hovered pin above the rest and puts it back after", async () => {
    await mount();
    const wrapper = pinFor("Ada london").element;
    const pin = wrapper.firstElementChild as HTMLElement;
    pin.dispatchEvent(new MouseEvent("mouseenter"));
    expect(wrapper.style.zIndex).toBe("5");
    expect(pin.style.transform).toBe("scale(1.15)");
    pin.dispatchEvent(new MouseEvent("mouseleave"));
    expect(wrapper.style.zIndex).toBe("2");
    expect(pin.style.transform).toBe("");
  });

  it("reports the view with longitudes wrapped into -180..180", async () => {
    await mount();
    expect(props.onBoundsChange).toHaveBeenLastCalledWith({ south: 10, west: 170, north: 50, east: -160 });
    fake.state.bounds = { south: 0, west: -200, north: 60, east: 200 };
    theMap().fire("moveend");
    expect(props.onBoundsChange).toHaveBeenLastCalledWith({ south: 0, west: -180, north: 60, east: 180 });
    fake.state.bounds = { south: 10, west: 170, north: 50, east: 200 };
  });

  it("opens on the viewer's home at regional zoom", async () => {
    await mount({ home: { lat: 43.7, lng: -72.29 } });
    expect(theMap().jumps).toEqual([{ center: [-72.29, 43.7], zoom: 7 }]);
    expect(theMap().fits).toHaveLength(0);
  });

  it("without a home, fits every place once, instantly", async () => {
    await mount();
    expect(theMap().fits).toHaveLength(1);
    expect(theMap().fits[0].bounds.points).toEqual([
      [-72.29, 43.7],
      [-0.13, 51.5],
    ]);
    expect(theMap().fits[0].options).toMatchObject({ padding: 48, maxZoom: 5, duration: 0 });

    await render({ places: [LONDON] });
    expect(theMap().fits).toHaveLength(1);
  });

  it("shows the whole world when there is no home and no places", async () => {
    await mount({ places: [] });
    expect(theMap().jumps).toEqual([{ center: [0, 25], zoom: 1 }]);
  });

  it("waits for the map to have a height before setting the view", async () => {
    height = 0;
    await mount({ home: { lat: 43.7, lng: -72.29 } });
    expect(theMap().jumps).toHaveLength(0);
  });

  it("keeps the minimum zoom tall enough to fill the map on resize", async () => {
    await mount();
    height = 2048;
    theMap().fire("resize");
    expect(theMap().setMinZoom).toHaveBeenLastCalledWith(2);
  });

  describe("clusters", () => {
    const BOSTON = place("boston", -71.06, 42.36, [person("b1"), person("b2"), person("b3")]);
    const CAMBRIDGE = place("cambridge", -71.11, 42.37, [person("c1")]);

    async function zoomTo(zoom: number) {
      theMap().zoom = zoom;
      await act(async () => theMap().fire("zoomend"));
    }

    it("draws nearby places as one pin on the biggest, counting everyone", async () => {
      await mount({ places: [CAMBRIDGE, BOSTON, LONDON], events: [] });
      expect(live()).toHaveLength(2);
      const cluster = pinFor("4 people");
      expect(cluster.lngLat).toEqual([-71.06, 42.36]);
      expect(cluster.element.querySelectorAll("span, img").length).toBe(4);
    });

    it("splits apart as the map zooms in and merges again zooming out", async () => {
      await mount({ places: [CAMBRIDGE, BOSTON], events: [] });
      expect(live()).toHaveLength(1);
      await zoomTo(12.4);
      expect(live().map((m) => m.element.firstElementChild!.lastElementChild!.textContent)).toEqual(["Ada b1 +2", "Ada c1"]);
      await zoomTo(3);
      expect(live()).toHaveLength(1);
    });

    it("counts only people who match the filters, unless none do", async () => {
      await mount({ places: [{ ...CAMBRIDGE, faded: true }, BOSTON], events: [] });
      expect(pinFor("3 people").element.firstElementChild!.getAttribute("data-faded")).toBe("false");
      await render({ places: [{ ...CAMBRIDGE, faded: true }, { ...BOSTON, faded: true }] });
      expect(pinFor("4 people").element.firstElementChild!.getAttribute("data-faded")).toBe("true");
    });

    it("clicking a cluster selects all its places and zooms to them", async () => {
      await mount({ places: [CAMBRIDGE, BOSTON], events: [], home: { lat: 43.7, lng: -72.29 } });
      (pinFor("4 people").element.firstElementChild as HTMLElement).click();
      expect(props.onSelect).toHaveBeenLastCalledWith(["boston", "cambridge"]);
      expect(theMap().fits).toHaveLength(1);
      expect(theMap().fits[0].options).toMatchObject({ maxZoom: 10 });
    });

    it("keeps each piece of a selected cluster highlighted after it splits", async () => {
      await mount({ places: [CAMBRIDGE, BOSTON], events: [], selectedKeys: ["boston", "cambridge"] });
      await zoomTo(12);
      expect(live().map((m) => m.element.style.zIndex)).toEqual(["3", "3"]);
      (pinFor("Ada c1").element.firstElementChild as HTMLElement).click();
      expect(props.onSelect).toHaveBeenLastCalledWith(null);
    });
  });

  it("removes the map on unmount", async () => {
    await mount();
    act(() => root.unmount());
    expect(theMap().removed).toBe(true);
    root = createRoot(host);
  });
});
