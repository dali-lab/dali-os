// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDraftAutosave, AUTOSAVE_DELAY_MS } from "../use-draft-autosave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useDraftAutosave<string>>;

let container: HTMLDivElement;
let root: Root;
let api: Api;
let send: ReturnType<typeof vi.fn<(payload: string) => void>>;
let busy = false;
let result: { ok?: boolean } | undefined;

function Harness() {
  api = useDraftAutosave<string>({
    send,
    busy,
    result,
    serialize: (p) => p,
    baseline: "base",
  });
  return null;
}

function render() {
  act(() => root.render(createElement(Harness)));
}

function settle(outcome: boolean) {
  busy = false;
  result = { ok: outcome };
  render();
}

function startSaving() {
  busy = true;
  render();
}

beforeEach(() => {
  vi.useFakeTimers();
  send = vi.fn<(payload: string) => void>();
  busy = false;
  result = undefined;
  container = document.createElement("div");
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useDraftAutosave", () => {
  it("sends one save after edits stop", () => {
    act(() => api.schedule("a"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1));
    act(() => api.schedule("ab"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1));
    expect(send).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("ab");
  });

  it("does not save content equal to the baseline", () => {
    act(() => api.schedule("base"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2));
    expect(send).not.toHaveBeenCalled();
    expect(api.status).toBe("idle");
  });

  it("does not save a revert to the last saved content", () => {
    act(() => api.schedule("a"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    startSaving();
    settle(true);
    send.mockClear();
    act(() => api.schedule("b"));
    act(() => api.schedule("a"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(send).not.toHaveBeenCalled();
  });

  it("queues edits made while a save is in flight instead of overlapping", () => {
    act(() => api.schedule("a"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    startSaving();
    act(() => api.schedule("b"));
    act(() => api.schedule("c"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(send).toHaveBeenCalledTimes(1);
    settle(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("c");
  });

  it("moves from saving to saved", () => {
    act(() => api.schedule("a"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(api.status).toBe("saving");
    startSaving();
    settle(true);
    expect(api.status).toBe("saved");
  });

  it("reports a failure and resends the same content on retry", () => {
    act(() => api.schedule("a"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    startSaving();
    settle(false);
    expect(api.status).toBe("error");
    expect(send).toHaveBeenCalledTimes(1);
    act(() => api.retry());
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("a");
    expect(api.status).toBe("saving");
  });

  it("flush sends pending content immediately and resolves once settled", async () => {
    act(() => api.schedule("a"));
    let resolved = false;
    act(() => {
      void api.flush().then(() => (resolved = true));
    });
    expect(send).toHaveBeenCalledWith("a");
    await act(async () => {});
    expect(resolved).toBe(false);
    startSaving();
    settle(true);
    await act(async () => {});
    expect(resolved).toBe(true);
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("flushes pending content when the page is hidden", () => {
    act(() => api.schedule("a"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(send).toHaveBeenCalledWith("a");
  });

  it("flushes pending content on pagehide and on unmount", () => {
    act(() => api.schedule("a"));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(send).toHaveBeenCalledTimes(1);
    startSaving();
    settle(true);
    act(() => api.schedule("b"));
    act(() => root.unmount());
    expect(send).toHaveBeenLastCalledWith("b");
    root = createRoot(container);
  });

  it("reset moves the baseline and drops pending content", () => {
    act(() => api.schedule("a"));
    act(() => api.reset("a"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(send).not.toHaveBeenCalled();
    act(() => api.schedule("a"));
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(send).not.toHaveBeenCalled();
  });
});
