// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { useSearchParamChoice, useSearchParamState } from "../useSearchParamState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
let current: [string, (next: string) => void];

let choice: [Tab, (next: Tab) => void];
const TABS = ["overview", "cleanup", "requests"] as const;
type Tab = (typeof TABS)[number];

function Probe({ debounceMs }: { debounceMs?: number }) {
  current = useSearchParamState("q", { debounceMs });
  choice = useSearchParamChoice<Tab>("tab", TABS, "overview");
  return null;
}

async function mount(entries: string[], debounceMs?: number) {
  router = createMemoryRouter(
    [{ path: "/list", Component: () => createElement(Probe, { debounceMs }) }],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router })));
}

const value = () => current[0];
const set = (next: string) => act(async () => current[1](next));
const search = () => router.state.location.search;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useSearchParamState", () => {
  it("starts from the URL", async () => {
    await mount(["/list?q=ada"]);
    expect(value()).toBe("ada");
  });

  it("starts empty when the param is missing", async () => {
    await mount(["/list"]);
    expect(value()).toBe("");
  });

  it("writes the param and replaces the history entry", async () => {
    await mount(["/list?term=t1"]);
    await set("ada");
    expect(value()).toBe("ada");
    expect(search()).toBe("?term=t1&q=ada");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("drops the param when cleared", async () => {
    await mount(["/list?term=t1&q=ada"]);
    await set("");
    expect(search()).toBe("?term=t1");
  });

  it("leaves history alone when the value doesn't change", async () => {
    await mount(["/list?q=ada"]);
    const before = router.state.location.key;
    await set("ada");
    expect(router.state.location.key).toBe(before);
  });

  it("follows the URL when it changes from outside", async () => {
    await mount(["/list?q=ada"]);
    await act(async () => router.navigate("/list?q=grace"));
    expect(value()).toBe("grace");
  });

  it("restores the earlier value on back", async () => {
    await mount(["/list?q=ada", "/list?q=grace"]);
    expect(value()).toBe("grace");
    await act(async () => router.navigate(-1));
    expect(value()).toBe("ada");
  });

  it("keeps the latest value when several writes land in a row", async () => {
    await mount(["/list"]);
    await act(async () => {
      current[1]("a");
      current[1]("ab");
      current[1]("abc");
    });
    expect(value()).toBe("abc");
    expect(search()).toBe("?q=abc");
  });

  describe("with debounceMs", () => {
    it("updates the value at once and the URL once typing stops", async () => {
      vi.useFakeTimers();
      await mount(["/list"], 300);
      await set("a");
      await set("ad");
      expect(value()).toBe("ad");
      expect(search()).toBe("");
      await act(async () => vi.advanceTimersByTime(299));
      expect(search()).toBe("");
      await act(async () => vi.advanceTimersByTime(1));
      expect(search()).toBe("?q=ad");
      expect(value()).toBe("ad");
    });

    it("cancels a pending write when the URL changes from outside", async () => {
      vi.useFakeTimers();
      await mount(["/list"], 300);
      await set("ada");
      await act(async () => router.navigate("/list?q=grace"));
      await act(async () => vi.advanceTimersByTime(300));
      expect(value()).toBe("grace");
      expect(search()).toBe("?q=grace");
    });
  });
});

describe("useSearchParamChoice", () => {
  it("is the default when the URL names nothing", async () => {
    await mount(["/list"]);
    expect(choice[0]).toBe("overview");
  });

  it("reads a known value", async () => {
    await mount(["/list?tab=cleanup"]);
    expect(choice[0]).toBe("cleanup");
  });

  it("reads an unknown value as the default", async () => {
    await mount(["/list?tab=bogus"]);
    expect(choice[0]).toBe("overview");
  });

  it("writes a pick, replacing history", async () => {
    await mount(["/list?term=t1"]);
    await act(async () => choice[1]("requests"));
    expect(choice[0]).toBe("requests");
    expect(search()).toBe("?term=t1&tab=requests");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("leaves the default out of the URL", async () => {
    await mount(["/list?tab=cleanup&term=t1"]);
    await act(async () => choice[1]("overview"));
    expect(search()).toBe("?term=t1");
  });

  it("follows back to an earlier pick", async () => {
    await mount(["/list?tab=cleanup", "/list?tab=requests"]);
    await act(async () => router.navigate(-1));
    expect(choice[0]).toBe("cleanup");
  });
});
