// @vitest-environment jsdom
//
// Browser capture's Stop, with the capture module mocked out. Kept apart
// from use-meeting-recording.test.tsx so that file keeps the real module.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import { DialogProvider } from "~/components/ui/dialog";
import { useMeetingRecording, type UseMeetingRecording } from "./use-meeting-recording";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/doc/collab-doc", () => ({
  acquireCollabDoc: () => ({
    provider: { awareness: { getLocalState: () => ({}), setLocalStateField: () => {} } },
  }),
  releaseCollabDoc: () => {},
}));
vi.mock("./worklet-processor.js?url", () => ({ default: "worklet.js" }));
vi.mock("./capture", () => ({
  captureCallAudio: vi.fn().mockRejectedValue(new Error("unsupported")),
  describeMicError: () => "mic error",
  listMicDevices: vi.fn().mockResolvedValue([]),
  openMic: vi.fn().mockResolvedValue({ getAudioTracks: () => [], getTracks: () => [] }),
  startLevelMeter: () => () => {},
  WorkletCapture: class {
    start = vi.fn().mockResolvedValue(undefined);
    flush = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn();
  },
}));

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function installLocalStoragePolyfill() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

let container: HTMLDivElement;
let root: Root;
const box: { current: UseMeetingRecording | null } = { current: null };

function Harness() {
  box.current = useMeetingRecording({ documentName: "doc-browser", canEdit: true, onInsert: () => true });
  return null;
}

async function mount() {
  const Stub = createRoutesStub([{ path: "/test", Component: Harness }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/test"] }))),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
}

let posted: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  installLocalStoragePolyfill();
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "POST") return jsonRes({ recording: null });
      posted.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      if (url === "/api/meeting-recordings") return jsonRes({ id: "r1", link: "dalios://record?id=r1", aiEnabled: true });
      return jsonRes({ ok: true });
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  box.current = null;
});

describe("browser capture Stop", () => {
  it("finishes the session with its length so the row is Stopped and Continue starts after it", async () => {
    await mount();
    const t0 = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(t0);
    await act(async () => {
      await box.current!.startBrowser();
    });
    expect(box.current!.phase).toBe("recording");
    expect(box.current!.captureMode).toBe("browser");

    vi.spyOn(Date, "now").mockReturnValue(t0 + 95_000);
    await act(async () => {
      await box.current!.stop();
    });

    const toRecording = posted.filter((p) => p.url === "/api/meeting-recordings/r1").map((p) => p.body);
    expect(toRecording).toEqual([{ action: "finish", seconds: 95 }]);
    expect(box.current!.recordedSeconds).toBe(95);
    expect(box.current!.phase).toBe("review");
  });
});
