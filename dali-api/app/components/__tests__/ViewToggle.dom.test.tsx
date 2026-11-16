// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useViewPreference, type ListView } from "../ViewToggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const original = Object.getOwnPropertyDescriptor(window, "localStorage");
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: [ListView, (next: ListView) => void];

function Probe() {
  latest = useViewPreference("test:view", "list");
  return createElement("span", null, latest[0]);
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  if (original) Object.defineProperty(window, "localStorage", original);
  window.localStorage.clear();
});

describe("useViewPreference", () => {
  it("restores a stored card view", async () => {
    window.localStorage.setItem("test:view", "card");
    await mount();
    expect(latest[0]).toBe("card");
  });

  it("renders the fallback and toggles when storage access throws", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    await mount();
    expect(latest[0]).toBe("list");
    await act(async () => latest[1]("card"));
    expect(latest[0]).toBe("card");
  });
});
