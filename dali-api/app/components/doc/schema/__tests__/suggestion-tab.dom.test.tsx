// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { acceptsSuggestionOnTab, useTabAcceptsSuggestion } from "../suggestion-tab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tab = { key: "Tab", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false };

describe("acceptsSuggestionOnTab", () => {
  it("accepts on a plain Tab while a menu is open", () => {
    expect(acceptsSuggestionOnTab(tab, true)).toBe(true);
  });

  it.each([
    ["no menu is open", tab, false],
    ["Shift+Tab", { ...tab, shiftKey: true }, true],
    ["Ctrl+Tab", { ...tab, ctrlKey: true }, true],
    ["Alt+Tab", { ...tab, altKey: true }, true],
    ["Cmd+Tab", { ...tab, metaKey: true }, true],
    ["an IME is composing", { ...tab, isComposing: true }, true],
    ["the key is not Tab", { ...tab, key: "a" }, true],
  ] as const)("leaves the key alone when %s", (_label, event, open) => {
    expect(acceptsSuggestionOnTab(event, open)).toBe(false);
  });
});

describe("useTabAcceptsSuggestion", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editorEl: HTMLDivElement;
  let paragraph: HTMLParagraphElement;
  let menuOpen: boolean;
  let seen: string[];
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map([["dali:doc-tab-accepts-suggestion", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  async function mount() {
    editorEl = document.createElement("div");
    editorEl.contentEditable = "true";
    paragraph = document.createElement("p");
    editorEl.append(paragraph);
    document.body.append(editorEl);
    seen = [];
    // Stands in for BlockNote's own capture listener on the editor element.
    editorEl.addEventListener("keydown", (e) => seen.push(e.key), true);
    const editor = {
      domElement: editorEl,
      getExtension: () => ({ shown: () => menuOpen }),
    };
    const Host = () => {
      useTabAcceptsSuggestion(editor as never);
      return null;
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Host)));
  }

  const press = (target: EventTarget, init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    editorEl.remove();
    vi.unstubAllGlobals();
  });

  it("leaves Tab alone while the setting is off, even with a menu open", async () => {
    store.clear();
    menuOpen = true;
    await mount();
    const event = press(paragraph, { key: "Tab" });
    expect(event.defaultPrevented).toBe(false);
    expect(seen).toEqual(["Tab"]);
  });

  it("picks up the setting without a reload", async () => {
    store.clear();
    menuOpen = true;
    await mount();
    store.set("dali:doc-tab-accepts-suggestion", "1");
    press(paragraph, { key: "Tab" });
    expect(seen).toEqual(["Enter"]);
  });

  it("replays Tab as Enter while a / or @ menu is open, so the highlighted item is picked", async () => {
    menuOpen = true;
    await mount();
    const event = press(paragraph, { key: "Tab" });
    expect(event.defaultPrevented).toBe(true);
    expect(seen).toEqual(["Enter"]);
  });

  it("lets Tab through to indent when no menu is open", async () => {
    menuOpen = false;
    await mount();
    const event = press(paragraph, { key: "Tab" });
    expect(event.defaultPrevented).toBe(false);
    expect(seen).toEqual(["Tab"]);
  });

  it("lets Shift+Tab through while a menu is open", async () => {
    menuOpen = true;
    await mount();
    press(paragraph, { key: "Tab", shiftKey: true });
    expect(seen).toEqual(["Tab"]);
  });

  it("ignores Tab pressed outside this editor", async () => {
    menuOpen = true;
    await mount();
    const outside = document.createElement("input");
    document.body.append(outside);
    const event = press(outside, { key: "Tab" });
    expect(event.defaultPrevented).toBe(false);
    expect(seen).toEqual([]);
    outside.remove();
  });

  it("stops listening once the editor unmounts", async () => {
    menuOpen = true;
    await mount();
    act(() => root.unmount());
    press(paragraph, { key: "Tab" });
    expect(seen).toEqual(["Tab"]);
    root = createRoot(container);
  });
});
