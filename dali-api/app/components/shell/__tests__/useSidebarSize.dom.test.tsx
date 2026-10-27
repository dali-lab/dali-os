// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSidebarSize } from "~/components/shell/useSidebarSize";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MediaListener = (e: { matches: boolean }) => void;

let narrow = false;
let mediaListeners: MediaListener[];

beforeEach(() => {
  narrow = false;
  mediaListeners = [];
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

  it("corrects to compact on a narrow desktop without animating", async () => {
    narrow = true;
    await mount();
    expect(latest.size).toBe("compact");
    expect(latest.instant).toBe(true);
  });

  it("goes compact when the window narrows, animated", async () => {
    await mount();
    await setNarrow(true);
    expect(latest.size).toBe("compact");
    expect(latest.instant).toBe(false);
  });

  it("returns to expanded when the window widens", async () => {
    narrow = true;
    await mount();
    await setNarrow(false);
    expect(latest.size).toBe("expanded");
  });

  it("stays expanded while disabled", async () => {
    narrow = true;
    await mount(false);
    expect(latest.size).toBe("expanded");
  });
});
