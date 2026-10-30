// @vitest-environment jsdom
//
// Browser capture surviving in-app navigation: the capture lives in
// live-session.ts, so a note unmounting and remounting adopts it instead of
// stopping it. Capture is mocked as in the browser-stop test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, useNavigate } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import { DialogProvider } from "~/components/ui/dialog";
import { useMeetingRecording, type UseMeetingRecording } from "./use-meeting-recording";
import { getLiveSession, resetLiveSession, startBrowserSession, stopLiveSession } from "./live-session";

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

const DOC = "doc:a:body";

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
let navigateTo: (path: string) => void = () => {};
const box: { current: UseMeetingRecording | null } = { current: null };
let serverStatus: "Recording" | "Stopped";
let posted: Array<{ url: string; body: unknown }>;

function Note() {
  box.current = useMeetingRecording({ documentName: DOC, canEdit: true, onInsert: () => true });
  navigateTo = useNavigate();
  return null;
}

function Elsewhere() {
  box.current = null;
  navigateTo = useNavigate();
  return null;
}

async function mount() {
  const Stub = createRoutesStub([
    { path: "/note", Component: Note },
    { path: "/elsewhere", Component: Elsewhere },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/note"] }))),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function go(path: string) {
  await act(async () => {
    navigateTo(path);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  installLocalStoragePolyfill();
  posted = [];
  serverStatus = "Recording";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posted.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        if (url === "/api/meeting-recordings") return jsonRes({ id: "r1", link: "dalios://record?id=r1", aiEnabled: true });
        return jsonRes({ ok: true });
      }
      if (url.endsWith("/active")) return jsonRes({ recording: null });
      return jsonRes({ status: serverStatus, channels: ["mic"], recordedSeconds: 0, lines: [], speakers: {}, segmentStarts: [0] });
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  resetLiveSession();
  vi.unstubAllGlobals();
  box.current = null;
});

describe("browser recording across in-app navigation", () => {
  it("keeps capturing when the note unmounts, with no prompt and no stop request", async () => {
    await mount();
    await act(async () => {
      await box.current!.startBrowser();
    });
    expect(box.current!.phase).toBe("recording");

    await go("/elsewhere");

    expect(document.body.textContent).not.toContain("Leave while recording?");
    expect(getLiveSession()?.status).toBe("recording");
    expect(posted.filter((p) => p.url.includes("/r1"))).toEqual([]);
  });

  it("adopts the live session when the note comes back instead of stopping it", async () => {
    await mount();
    await act(async () => {
      await box.current!.startBrowser();
    });
    const startedAt = getLiveSession()!.startedAt;
    await go("/elsewhere");
    await go("/note");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(box.current!.phase).toBe("recording");
    expect(box.current!.captureMode).toBe("browser");
    expect(box.current!.error).toBeNull();
    expect(box.current!.channelsActive).toEqual(["mic"]);
    expect(box.current!.open).toBe(true);
    expect(getLiveSession()).toMatchObject({ status: "recording", startedAt });
    expect(posted.filter((p) => p.url.includes("/r1"))).toEqual([]);
  });

  it("lands in review with the session length when the stop finished while away", async () => {
    await mount();
    await act(async () => {
      await box.current!.startBrowser();
    });
    await go("/elsewhere");
    serverStatus = "Stopped";
    await act(async () => {
      await stopLiveSession();
    });
    await go("/note");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(box.current!.phase).toBe("review");
    expect(box.current!.error).toBeNull();
    expect(box.current!.captureMode).toBe("browser");
  });

  it("goes to review when a stop completes while the note is open", async () => {
    await mount();
    await act(async () => {
      await box.current!.startBrowser();
    });
    await act(async () => {
      await stopLiveSession();
    });
    expect(box.current!.phase).toBe("review");
  });

  it("still stops with the reload message when a backup has no live session in memory", async () => {
    window.localStorage.setItem(
      `dali:meeting-recording:${DOC}`,
      JSON.stringify({ id: "r1", link: "", aiEnabled: false, captureMode: "browser" }),
    );
    await mount();

    expect(box.current!.phase).toBe("review");
    expect(box.current!.error).toBe("Recording stopped when this page reloaded. Continue to pick it up.");
    expect(posted).toContainEqual({ url: "/api/meeting-recordings/r1", body: { action: "stop" } });
  });

  it("refuses to start a second recording while another note is live", async () => {
    await act(async () => {
      await startBrowserSession({
        recordingId: "other",
        documentName: "doc:b:body",
        micStream: { getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream,
        segment: 0,
      });
    });
    await mount();
    await act(async () => {
      await box.current!.startBrowser();
    });

    expect(box.current!.error).toMatch(/^Stop the recording in .+ first\.$/);
    expect(box.current!.phase).toBe("idle");
    expect(posted).toEqual([]);
  });
});
