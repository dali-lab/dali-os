// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useEventStream } from "~/hooks/useEventStream";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeEventSource {
  static all: FakeEventSource[] = [];
  listeners = new Map<string, (() => void)[]>();
  closed = false;
  constructor(
    public url: string,
    public init?: EventSourceInit,
  ) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

let root: Root;
let container: HTMLElement;

function Probe({ urls, onEvent }: { urls: string[]; onEvent: () => void }) {
  useEventStream(urls, onEvent);
  return null;
}

const render = (urls: string[], onEvent: () => void) =>
  act(() => root.render(createElement(Probe, { urls, onEvent })));

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("useEventStream", () => {
  it("opens one credentialed stream per distinct url", () => {
    render(["/a", "/b", "/a"], vi.fn());
    expect(FakeEventSource.all.map((e) => e.url).sort()).toEqual(["/a", "/b"]);
    expect(FakeEventSource.all.every((e) => e.init?.withCredentials)).toBe(true);
  });

  it("opens nothing for an empty list", () => {
    render([], vi.fn());
    expect(FakeEventSource.all).toHaveLength(0);
  });

  it("calls onEvent on change and on sync", () => {
    const onEvent = vi.fn();
    render(["/a"], onEvent);
    FakeEventSource.all[0].emit("change");
    FakeEventSource.all[0].emit("sync");
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("ignores other event types", () => {
    const onEvent = vi.fn();
    render(["/a"], onEvent);
    FakeEventSource.all[0].emit("message");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("uses the latest onEvent without reopening the stream", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(["/a"], first);
    render(["/a"], second);
    expect(FakeEventSource.all).toHaveLength(1);
    FakeEventSource.all[0].emit("change");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("keeps the same streams when the url list only reorders", () => {
    render(["/a", "/b"], vi.fn());
    render(["/b", "/a"], vi.fn());
    expect(FakeEventSource.all).toHaveLength(2);
    expect(FakeEventSource.all.some((e) => e.closed)).toBe(false);
  });

  it("closes the old streams when the urls change", () => {
    render(["/a"], vi.fn());
    render(["/b"], vi.fn());
    expect(FakeEventSource.all[0].closed).toBe(true);
    expect(FakeEventSource.all[1].url).toBe("/b");
    expect(FakeEventSource.all[1].closed).toBe(false);
  });

  it("closes every stream on unmount", () => {
    render(["/a", "/b"], vi.fn());
    act(() => root.unmount());
    expect(FakeEventSource.all.every((e) => e.closed)).toBe(true);
    root = createRoot(container);
  });
});
