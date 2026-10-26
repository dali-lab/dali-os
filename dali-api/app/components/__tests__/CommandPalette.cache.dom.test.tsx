// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette, paletteSearchCache } from "../CommandPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const hit = (title: string) => ({ type: "project", id: title, title, url: `/projects/${title}` });

function mount(open: boolean) {
  act(() =>
    root.render(
      createElement(CommandPalette, { open, onClose: () => {}, tabless: false, focusMode: false, onOpen: () => {} }),
    ),
  );
}

async function type(value: string) {
  const input = document.body.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers();
  paletteSearchCache.clear();
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => ({ results: [hit(`Result for ${new URL(url, "http://x").searchParams.get("q")}`)] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CommandPalette search cache", () => {
  it("debounces the request to the last query typed", async () => {
    mount(true);
    await type("ad");
    await advance(50);
    await type("ada");
    await advance(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/search?q=ada");
    expect(text()).toContain("Result for ada");
  });

  it("shows a query seen before without waiting for the network, then refreshes it", async () => {
    mount(true);
    await type("ada");
    await advance(200);
    await type("");
    await type("adx");
    await advance(200);

    fetchMock.mockImplementation(() => new Promise(() => {}));
    await type("ada");
    expect(text()).toContain("Result for ada");
    expect(text()).not.toContain("Searching");

    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ results: [hit("Newer ada")] }) }));
    await advance(200);
    expect(text()).toContain("Newer ada");
  });

  it("stops the spinner when the request fails", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    mount(true);
    await type("zzz");
    await advance(200);
    expect(text()).not.toContain("Searching");
  });

  it("does not search for a single character", async () => {
    mount(true);
    await type("a");
    await advance(300);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
