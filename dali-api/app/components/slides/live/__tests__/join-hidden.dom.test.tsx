// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { joinKey, useJoinHidden } from "../useJoinHidden";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) if (c !== this && c.name === this.name) c.onmessage?.({ data } as MessageEvent);
  }
  close() {
    FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
  }
}

let roots: Array<{ root: Root; el: HTMLElement }> = [];
let setters: Array<(h: boolean) => void> = [];
const Probe = ({ i }: { i: number }) => {
  const [hidden, set] = useJoinHidden("p1");
  setters[i] = set;
  return createElement("output", null, String(hidden));
};
const open = (i: number) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  act(() => root.render(createElement(Probe, { i })));
  return () => el.textContent;
};

beforeEach(() => {
  localStorage.clear();
  FakeChannel.all = [];
  vi.stubGlobal("BroadcastChannel", FakeChannel);
});
afterEach(() => {
  roots.forEach(({ root, el }) => {
    act(() => root.unmount());
    el.remove();
  });
  roots = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useJoinHidden", () => {
  it("starts shown and updates both windows from either one", () => {
    const a = open(0);
    const b = open(1);
    expect([a(), b()]).toEqual(["false", "false"]);
    act(() => setters[0](true));
    expect([a(), b()]).toEqual(["true", "true"]);
    act(() => setters[1](false));
    expect([a(), b()]).toEqual(["false", "false"]);
  });

  it("reads the current state when a window opens", () => {
    localStorage.setItem(joinKey("p1"), "1");
    expect(open(0)()).toBe("true");
  });

  it("works in a single window", () => {
    const a = open(0);
    act(() => setters[0](true));
    expect(a()).toBe("true");
  });

  it("follows the storage event when there is no BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const a = open(0);
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: joinKey("p1"), newValue: "1" })));
    expect(a()).toBe("true");
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "0" })));
    expect(a()).toBe("true");
  });

  it("falls back to this window without throwing when the channel and storage fail", () => {
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("no"); } });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const a = open(0);
    expect(a()).toBe("false");
    act(() => setters[0](true));
    expect(a()).toBe("true");
  });
});
