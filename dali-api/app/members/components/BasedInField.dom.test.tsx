// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderDom } from "~/test-utils/render";
import { BasedInField, BasedInFeedback, structuredPlace, type BasedInValue } from "./BasedInField";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const empty: BasedInValue = {
  currentLocation: null,
  currentLocationGeonameId: null,
  currentLocationLat: null,
  currentLocationCity: null,
  currentLocationRegion: null,
  currentLocationCountry: null,
};

const freeFound: BasedInValue = {
  ...empty,
  currentLocation: "hanover nh",
  currentLocationLat: 43.7,
  currentLocationCity: "Hanover",
  currentLocationRegion: "New Hampshire",
  currentLocationCountry: "United States",
};

describe("BasedInFeedback", () => {
  it("names where free text landed on the map", () => {
    const { container } = renderDom(<BasedInFeedback value={freeFound} />);
    expect(container.textContent).toBe("On the map as Hanover, New Hampshire, United States");
    expect(container.querySelector("strong")?.textContent).toBe("Hanover, New Hampshire, United States");
  });

  it("warns when free text has no coordinates", () => {
    const { container } = renderDom(
      <BasedInFeedback value={{ ...freeFound, currentLocationLat: null }} />,
    );
    expect(container.textContent).toBe("Not found on the map. Try a city and country.");
    expect(container.querySelector("p")?.className).toContain("text-os-amber");
  });

  it("shows nothing for a picked city or an empty field", () => {
    const picked = renderDom(<BasedInFeedback value={{ ...freeFound, currentLocationGeonameId: 5 }} />);
    expect(picked.container.textContent).toBe("");
    const none = renderDom(<BasedInFeedback value={empty} />);
    expect(none.container.textContent).toBe("");
  });
});

describe("structuredPlace", () => {
  it("prefers City, Region and falls back to the raw text", () => {
    expect(structuredPlace(freeFound)).toBe("Hanover, New Hampshire");
    expect(structuredPlace({ ...freeFound, currentLocationCity: null, currentLocationRegion: null })).toBe("hanover nh");
    expect(structuredPlace(empty)).toBeNull();
  });
});

describe("BasedInField", () => {
  function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const hidden = (c: HTMLElement, name: string) =>
    c.querySelector<HTMLInputElement>(`input[name='${name}']`)!.value;

  it("starts from the saved value with its feedback line", () => {
    const { container } = renderDom(<BasedInField value={freeFound} />);
    expect(hidden(container, "currentLocation")).toBe("hanover nh");
    expect(hidden(container, "currentLocationGeonameId")).toBe("");
    expect(container.textContent).toContain("On the map as");
  });

  it("posts the picked city's label and geoname id", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            geonameId: 5110302,
            name: "Brooklyn",
            region: "New York",
            country: "United States",
            label: "Brooklyn, New York, United States",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderDom(<BasedInField value={empty} />);
    const input = container.querySelector<HTMLInputElement>("input[role='combobox']")!;
    act(() => input.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    typeInto(input, "brook");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/places/search?q=brook", expect.anything());
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']"));
    expect(rows[0].textContent).toContain("Brooklyn");
    expect(rows[0].textContent).toContain("New York, United States");
    expect(rows[1].textContent).toContain("Use “brook”");
    act(() => rows[0].click());
    expect(hidden(container, "currentLocation")).toBe("Brooklyn, New York, United States");
    expect(hidden(container, "currentLocationGeonameId")).toBe("5110302");
    expect(container.textContent).not.toContain("On the map");
  });

  it("posts only the text, with no geoname id, for a Use row", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) }));
    const { container } = renderDom(
      <BasedInField value={{ ...empty, currentLocation: "Old", currentLocationGeonameId: 7 }} />,
    );
    const input = container.querySelector<HTMLInputElement>("input[role='combobox']")!;
    act(() => input.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    typeInto(input, "My village");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']"));
    expect(rows).toHaveLength(1);
    act(() => rows[0].click());
    expect(hidden(container, "currentLocation")).toBe("My village");
    expect(hidden(container, "currentLocationGeonameId")).toBe("");
  });

  it("clears both fields", () => {
    const { container } = renderDom(
      <BasedInField value={{ ...empty, currentLocation: "Hanover, New Hampshire, United States", currentLocationGeonameId: 7 }} />,
    );
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label='Clear']")!.click());
    expect(hidden(container, "currentLocation")).toBe("");
    expect(hidden(container, "currentLocationGeonameId")).toBe("");
  });

  it("does not search for fewer than two characters", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderDom(<BasedInField value={empty} />);
    const input = container.querySelector<HTMLInputElement>("input[role='combobox']")!;
    act(() => input.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    typeInto(input, "b");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
