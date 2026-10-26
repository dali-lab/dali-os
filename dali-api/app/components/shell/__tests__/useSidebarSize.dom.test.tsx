// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSidebarSize } from "~/components/shell/useSidebarSize";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MediaListener = (e: { matches: boolean }) => void;

let narrow = false;
let mediaListeners: MediaListener[];
let stored: Map<string, string>;

beforeEach(() => {
  narrow = false;
  mediaListeners = [];
  stored = new Map();
  // Node 22 ships an unavailable experimental localStorage that can shadow
  // jsdom's, so the test provides its own.
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
      clear: () => stored.clear(),
    },
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return narrow;
    },
    media: query,
    addEventListener: (_: string, fn: MediaListener) => mediaListeners.push(fn),
    removeEventListener: (_: string, fn: MediaListener) => {
      mediaListeners = mediaListeners.filter((l) => l !== fn);
    },
  })) as typeof window.matchMedia;
});

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useSidebarSize>;

function Probe({ enabled }: { enabled: boolean }) {
  latest = useSidebarSize(enabled);
  return null;
}

async function mount(enabled = true) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { enabled }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const setNarrow = async (matches: boolean) => {
  narrow = matches;
  await act(async () => {
    mediaListeners.forEach((fn) => fn({ matches }));
  });
};

describe("useSidebarSize", () => {
  it("starts expanded and lands without animating", async () => {
    await mount();
    expect(latest.size).toBe("expanded");
    expect(latest.instant).toBe(true);
  });

  it("toggles to compact and remembers the choice", async () => {
    await mount();
    await act(async () => latest.toggle("pointer"));
    expect(latest.size).toBe("compact");
    expect(latest.instant).toBe(false);
    expect(window.localStorage.getItem("dali:rail:size")).toBe("compact");
  });

  it("restores the stored size on mount", async () => {
    window.localStorage.setItem("dali:rail:size", "compact");
    await mount();
    expect(latest.size).toBe("compact");
    expect(latest.instant).toBe(true);
  });

  it("skips the animation on a keyboard toggle", async () => {
    await mount();
    await act(async () => latest.toggle("keyboard"));
    expect(latest.size).toBe("compact");
    expect(latest.instant).toBe(true);
  });

  it("goes compact on a narrow desktop without saving it", async () => {
    await mount();
    await setNarrow(true);
    expect(latest.size).toBe("compact");
    expect(window.localStorage.getItem("dali:rail:size")).toBeNull();
  });

  it("returns to the preferred size when the window widens", async () => {
    window.localStorage.setItem("dali:rail:size", "expanded");
    narrow = true;
    await mount();
    expect(latest.size).toBe("compact");
    await setNarrow(false);
    expect(latest.size).toBe("expanded");
  });

  it("does not persist a toggle made while narrow", async () => {
    narrow = true;
    await mount();
    await act(async () => latest.toggle("pointer"));
    expect(latest.size).toBe("expanded");
    expect(window.localStorage.getItem("dali:rail:size")).toBeNull();
    await setNarrow(false);
    expect(latest.size).toBe("expanded");
  });

  it("stays expanded while disabled", async () => {
    narrow = true;
    window.localStorage.setItem("dali:rail:size", "compact");
    await mount(false);
    expect(latest.size).toBe("expanded");
  });
});
