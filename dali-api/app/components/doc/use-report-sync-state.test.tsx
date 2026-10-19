// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocketStatus } from "@hocuspocus/provider";
import { SAVING_MIN_VISIBLE_MS, SAVING_SHOW_DELAY_MS, useReportSyncState } from "./use-report-sync-state";
import type { DocSyncState } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeProvider() {
  const handlers = new Map<string, Set<(arg?: unknown) => void>>();
  const provider = {
    hasUnsyncedChanges: false,
    synced: true,
    configuration: { websocketProvider: { status: WebSocketStatus.Connected } },
    on(event: string, fn: (arg?: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return provider;
    },
    off(event: string, fn: (arg?: unknown) => void) {
      handlers.get(event)?.delete(fn);
      return provider;
    },
    fire(event: string, arg?: unknown) {
      act(() => handlers.get(event)?.forEach((fn) => fn(arg)));
    },
    listenerCount: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
  };
  return provider;
}

type Fake = ReturnType<typeof fakeProvider>;

let container: HTMLDivElement;
let root: Root;
let reports: DocSyncState[];

function Harness({ provider }: { provider: Fake }) {
  useReportSyncState(provider as never, (s) => reports.push(s));
  return null;
}

function mount(provider: Fake) {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(createElement(Harness, { provider })));
}

function edit(p: Fake) {
  p.hasUnsyncedChanges = true;
  p.fire("unsyncedChanges");
}

function ack(p: Fake) {
  p.hasUnsyncedChanges = false;
  p.fire("unsyncedChanges");
}

function advance(ms: number) {
  act(() => void vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  reports = [];
});

afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
});

describe("useReportSyncState", () => {
  it("reports the initial state immediately", () => {
    mount(fakeProvider());
    expect(reports).toEqual(["saved"]);
  });

  it("never reports saving for edits the server acks quickly", () => {
    const p = fakeProvider();
    mount(p);
    for (let i = 0; i < 20; i++) {
      edit(p);
      advance(50);
      ack(p);
      advance(50);
    }
    advance(SAVING_SHOW_DELAY_MS * 2);
    expect(reports).toEqual(["saved"]);
  });

  it("does not report saving before the show delay elapses", () => {
    const p = fakeProvider();
    mount(p);
    edit(p);
    advance(SAVING_SHOW_DELAY_MS - 1);
    expect(reports).toEqual(["saved"]);
  });

  it("reports saving once a save is still pending after the show delay", () => {
    const p = fakeProvider();
    mount(p);
    edit(p);
    advance(SAVING_SHOW_DELAY_MS);
    expect(reports).toEqual(["saved", "saving"]);
  });

  it("does not restart the show delay on further edits while one is pending", () => {
    const p = fakeProvider();
    mount(p);
    edit(p);
    advance(SAVING_SHOW_DELAY_MS / 2);
    edit(p);
    advance(SAVING_SHOW_DELAY_MS / 2);
    expect(reports).toEqual(["saved", "saving"]);
  });

  it("holds saving for the minimum visible time before reporting saved", () => {
    const p = fakeProvider();
    mount(p);
    edit(p);
    advance(SAVING_SHOW_DELAY_MS);
    ack(p);
    expect(reports).toEqual(["saved", "saving"]);
    advance(SAVING_MIN_VISIBLE_MS - 1);
    expect(reports).toEqual(["saved", "saving"]);
    advance(1);
    expect(reports).toEqual(["saved", "saving", "saved"]);
  });

  it("reports saved right away when saving has already been visible long enough", () => {
    const p = fakeProvider();
    mount(p);
    edit(p);
    advance(SAVING_SHOW_DELAY_MS + SAVING_MIN_VISIBLE_MS);
    ack(p);
    expect(reports).toEqual(["saved", "saving", "saved"]);
  });

  it("stays on saving when a new edit lands during the minimum visible hold", () => {
    const p = fakeProvider();
    mount(p);
    edit(p);
    advance(SAVING_SHOW_DELAY_MS);
    ack(p);
    advance(SAVING_MIN_VISIBLE_MS / 2);
    edit(p);
    advance(SAVING_MIN_VISIBLE_MS * 4);
    expect(reports).toEqual(["saved", "saving"]);
  });

  it("treats a provider that has not synced yet as saving", () => {
    const p = fakeProvider();
    p.synced = false;
    mount(p);
    expect(reports).toEqual(["saving"]);
    advance(SAVING_MIN_VISIBLE_MS);
    p.synced = true;
    p.fire("synced");
    expect(reports).toEqual(["saving", "saved"]);
  });

  it("reports offline immediately on disconnect, even mid show delay", () => {
    const p = fakeProvider();
    mount(p);
    edit(p);
    p.fire("disconnect");
    expect(reports).toEqual(["saved", "offline"]);
    advance(SAVING_SHOW_DELAY_MS * 2);
    expect(reports).toEqual(["saved", "offline"]);
  });

  it("reports offline from a status event and the true state immediately on reconnect", () => {
    const p = fakeProvider();
    mount(p);
    p.fire("status", { status: WebSocketStatus.Disconnected });
    expect(reports).toEqual(["saved", "offline"]);
    p.hasUnsyncedChanges = true;
    p.fire("connect");
    expect(reports).toEqual(["saved", "offline", "saving"]);
  });

  it("starts offline when the socket is not connected at mount", () => {
    const p = fakeProvider();
    p.configuration.websocketProvider.status = WebSocketStatus.Connecting;
    mount(p);
    expect(reports).toEqual(["offline"]);
  });

  it("unsubscribes and cancels pending timers on unmount", () => {
    const p = fakeProvider();
    mount(p);
    edit(p);
    act(() => root.unmount());
    advance(SAVING_SHOW_DELAY_MS * 2);
    expect(reports).toEqual(["saved"]);
    expect(p.listenerCount()).toBe(0);
  });
});
