// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { AskButton } from "../components/AskButton";
import { sharedAskThread } from "../thread";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let search = "";

function Location() {
  search = useLocation().search;
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
  search = "";
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
    expect(search).toBe("");
  });

  it("opens the Ask panel and closes it again", () => {
    mount(true);
    expect(askButton()!.getAttribute("aria-pressed")).toBe("false");
    act(() => askButton()!.click());
    expect(new URLSearchParams(search).get("side")).toBe("ask:dali");
    expect(askButton()!.getAttribute("aria-pressed")).toBe("true");
    act(() => askButton()!.click());
    expect(new URLSearchParams(search).get("side")).toBeNull();
  });

  it("toggles with ⌘J", () => {
    mount(true);
    pressCmdJ();
    expect(new URLSearchParams(search).get("side")).toBe("ask:dali");
    pressCmdJ();
    expect(new URLSearchParams(search).get("side")).toBeNull();
  });

  it("opens without asking anything", () => {
    const ask = vi.spyOn(sharedAskThread(), "ask");
    mount(true);
    act(() => askButton()!.click());
    expect(ask).not.toHaveBeenCalled();
    ask.mockRestore();
  });
});
