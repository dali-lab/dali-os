// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { useVisibleSidePanel } from "~/components/side-panel/use-side-panel";
import { formatSidePanel, setKeptSidePanel } from "~/lib/side-panel";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { AskButton } from "../components/AskButton";
import { sharedAskThread } from "../thread";

const loadAskPanel = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("../components/load-ask-panel", () => ({ loadAskPanel }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let shown = "";

function Location() {
  const panel = useVisibleSidePanel();
  shown = panel ? formatSidePanel(panel) : "";
  return null;
}

function mount(enabled: boolean, path = "/projects") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <FeatureFlagsProvider flags={{ "ask-dali": enabled }}>
        <MemoryRouter initialEntries={[path]}>
          <AskButton />
          <Location />
        </MemoryRouter>
      </FeatureFlagsProvider>,
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  shown = "";
  act(() => setKeptSidePanel(null));
  window.history.replaceState(null, "", "/");
  loadAskPanel.mockClear();
  vi.useRealTimers();
});

const askButton = () =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Ask"));
const pressCmdJ = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", metaKey: true, ctrlKey: true, cancelable: true }));
  });

describe("AskButton", () => {
  it("is hidden while the flag is off, and ⌘J does nothing", () => {
    mount(false);
    expect(askButton()).toBeUndefined();
    pressCmdJ();
    expect(shown).toBe("");
  });

  it("opens the Ask panel and closes it again", () => {
    mount(true);
    expect(askButton()!.getAttribute("aria-pressed")).toBe("false");
    act(() => askButton()!.click());
    expect(shown).toBe("ask:dali");
    expect(askButton()!.getAttribute("aria-pressed")).toBe("true");
    act(() => askButton()!.click());
    expect(shown).toBe("");
  });

  it("toggles with ⌘J", () => {
    mount(true);
    pressCmdJ();
    expect(shown).toBe("ask:dali");
    pressCmdJ();
    expect(shown).toBe("");
  });

  it("opens without asking anything", () => {
    const ask = vi.spyOn(sharedAskThread(), "ask");
    mount(true);
    act(() => askButton()!.click());
    expect(ask).not.toHaveBeenCalled();
    ask.mockRestore();
  });

  it("loads the panel's code while idle, so the first open doesn't wait for it", () => {
    vi.useFakeTimers();
    mount(true);
    act(() => vi.runAllTimers());
    expect(loadAskPanel).toHaveBeenCalledTimes(1);
  });

  it("loads nothing while the flag is off", () => {
    vi.useFakeTimers();
    mount(false);
    act(() => vi.runAllTimers());
    expect(loadAskPanel).not.toHaveBeenCalled();
  });
});
