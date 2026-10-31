// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { PlaceList } from "../PlaceList";
import type { ConnectAlum, ConnectPlace } from "~/members/lib/connect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const alum = (place: string, n: number): ConnectAlum => ({
  id: `${place}-${n}`,
  name: `Ada ${place} ${n}`,
  photoUrl: null,
  classYear: 2020,
  location: place,
  lat: 0,
  lng: 0,
  currentJob: null,
});
const place = (key: string, count: number): ConnectPlace => ({
  key,
  label: key,
  lat: 0,
  lng: 0,
  alumni: Array.from({ length: count }, (_, i) => alum(key, i)),
});

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(Component: () => ReturnType<typeof createElement>) {
  const Stub = createRoutesStub([{ path: "/", Component }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

const places = [place("Hanover", 40), place("Boston", 30), place("Austin", 10)];

function Harness({ initialSelected = null }: { initialSelected?: string | null }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelected);
  const [query, setQuery] = useState("");
  return createElement(PlaceList, {
    places,
    selected: places.find((p) => p.key === selectedKey) ?? null,
    onSelect: setSelectedKey,
    query,
    onQueryChange: setQuery,
    hasAlumni: true,
  });
}

const headers = () => [...container.querySelectorAll("section")].map((s) => s.firstElementChild?.textContent);
const loadMore = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more") as HTMLButtonElement | undefined;

describe("PlaceList", () => {
  it("slices alumni across places to 50 and keeps the totals on the full set", async () => {
    await mount(() => createElement(Harness));
    expect(container.textContent).toContain("80 alumni in 3 places");
    expect(container.textContent).toContain("Showing 50 of 80");
    expect(container.textContent).toContain("Ada Hanover 39");
    expect(container.textContent).toContain("Ada Boston 9");
    expect(container.textContent).not.toContain("Ada Boston 10");
    expect(container.textContent).not.toContain("Ada Austin");
    expect(headers()).toHaveLength(2);
    expect(headers()[1]).toContain("30");
  });

  it("Load more continues the split place and then the next one", async () => {
    await mount(() => createElement(Harness));
    await act(async () => loadMore()!.click());
    expect(container.textContent).toContain("Ada Boston 29");
    expect(container.textContent).toContain("Ada Austin 9");
    expect(headers()).toHaveLength(3);
    expect(loadMore()).toBeUndefined();
  });

  it("selecting a place shows it from the top, and clearing returns to the first slice", async () => {
    await mount(() => createElement(Harness));
    await act(async () => loadMore()!.click());
    const austin = [...container.querySelectorAll("section > button")].find((b) => b.textContent?.includes("Austin"))!;
    await act(async () => (austin as HTMLButtonElement).click());
    expect(container.textContent).toContain("Ada Austin 0");
    expect(container.textContent).not.toContain("Ada Hanover");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Show all places"]')!.click());
    expect(container.textContent).toContain("Showing 50 of 80");
  });

  it("slices a large selected place on its own", async () => {
    const big = [place("Hanover", 120)];
    function Big() {
      return createElement(PlaceList, {
        places: big,
        selected: big[0],
        onSelect: () => {},
        query: "",
        onQueryChange: () => {},
        hasAlumni: true,
      });
    }
    await mount(Big);
    expect(container.textContent).toContain("Showing 50 of 120");
    await act(async () => loadMore()!.click());
    expect(container.textContent).toContain("Showing 100 of 120");
  });
});
