// @vitest-environment jsdom
//
// Drives the hook through phase transitions without a browser (mocked
// fetch, no real mic/capture APIs) — a Harness component mounted inside a
// react-router stub (useSearchParams/useBlocker need a real Router context)
// mirrors app/components/board/useOptimisticBoardMove.test.tsx's hook-harness
// pattern, since @testing-library isn't a dependency here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import { DialogProvider } from "~/components/ui/dialog";
import { useMeetingRecording, type UseMeetingRecording } from "./use-meeting-recording";
import type { LatestRecording } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function backupKey(documentName: string) {
  return `dali:meeting-recording:${documentName}`;
}

// jsdom's own localStorage needs a --localstorage-file path this repo's
// Vitest config doesn't set; swap in a plain in-memory polyfill for the
// hook's readBackup/writeBackup to work against.
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

function Harness({
  documentName,
  latestRecording,
}: {
  documentName: string;
  latestRecording?: LatestRecording | null;
}) {
  box.current = useMeetingRecording({ documentName, canEdit: true, onInsert: () => true, latestRecording });
  return null;
}

async function mount(documentName: string) {
  const Stub = createRoutesStub([{ path: "/test", Component: () => createElement(Harness, { documentName }) }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/test"] })),
      ),
    );
    // Lets the claim-backup effect's fetch (and its state updates) settle.
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mountWithLatest(documentName: string, latestRecording: LatestRecording) {
  const Stub = createRoutesStub([
    { path: "/test", Component: () => createElement(Harness, { documentName, latestRecording }) },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/test"] })),
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
}

// Mirrors documents.$pageId.tsx's RecordingMount: a parent holds documentName
// in state (standing in for a notebook-tab switch, which re-renders the SAME
// route component with a new documentName prop) and renders Harness keyed by
// it, the way RecordingMountInner is now keyed. `keyed=false` reproduces the
// bug the key fixes.
let driverSetDocumentName: (next: string) => void = () => {
  throw new Error("mountDriver was not called");
};

function Driver({ initial, keyed }: { initial: string; keyed: boolean }) {
  const [documentName, setDocumentName] = useState(initial);
  driverSetDocumentName = setDocumentName;
  return keyed
    ? createElement(Harness, { key: documentName, documentName })
    : createElement(Harness, { documentName });
}

async function mountDriver(initial: string, keyed: boolean) {
  const Stub = createRoutesStub([{ path: "/test", Component: () => createElement(Driver, { initial, keyed }) }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/test"] })),
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function switchDocument(next: string) {
  await act(async () => {
    driverSetDocumentName(next);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  installLocalStoragePolyfill();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  box.current = null;
});

describe("useMeetingRecording phase transitions (mocked fetch, no browser capture)", () => {
  it("recording -> stopping: stop() flips phase immediately for a desktop capture", async () => {
    const documentName = "doc-stop";
    window.localStorage.setItem(
      backupKey(documentName),
      JSON.stringify({ id: "r1", link: "l", aiEnabled: true, captureMode: "desktop" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonRes({ status: "Recording", channels: ["mic"], recordedSeconds: 10, lines: [], speakers: {} });
        }
        return jsonRes({});
      }),
    );

    await mount(documentName);
    expect(box.current!.phase).toBe("recording");
    expect(box.current!.captureMode).toBe("desktop");

    await act(async () => {
      await box.current!.stop();
    });
    expect(box.current!.phase).toBe("stopping");
  });

  it("review -> processing: finishAndTranscribe() posts the final stop and moves on without waiting for a poll", async () => {
    const documentName = "doc-review";
    window.localStorage.setItem(
      backupKey(documentName),
      JSON.stringify({ id: "r2", link: "l", aiEnabled: true, captureMode: "desktop" }),
    );
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonRes({ status: "Stopped", channels: [], recordedSeconds: 42, lines: [], speakers: {} });
        }
        posted.push(JSON.parse(String(init?.body ?? "{}")));
        return jsonRes({});
      }),
    );

    await mount(documentName);
    expect(box.current!.phase).toBe("review");

    await act(async () => {
      await box.current!.finishAndTranscribe();
    });
    expect(box.current!.phase).toBe("processing");
    expect(posted).toContainEqual({ action: "stop", final: true });
  });

  it("processing -> done: the processing poll adopts the server's lines and speakers", async () => {
    const documentName = "doc-processing";
    window.localStorage.setItem(
      backupKey(documentName),
      JSON.stringify({ id: "r3", link: "l", aiEnabled: true, captureMode: "desktop" }),
    );
    // The claim-backup fetch (call 1) sees "Processing" — the processing
    // poll's own tick (call 2+, fired by the processing-poll effect that
    // mounts once phase becomes "processing") is what later sees "Done".
    // Both resolve within the same microtask flush as the claim effect (no
    // real I/O here), so the intermediate "processing" render isn't
    // separately observable — the call count is what proves the poll ran.
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return jsonRes({ status: "Processing", channels: [], recordedSeconds: 90, lines: [], speakers: {} });
      }
      return jsonRes({
        status: "Done",
        channels: [],
        recordedSeconds: 90,
        lines: [{ at: 1, end: 2, text: "hello", speaker: "mic:1", channel: "mic" }],
        speakers: {},
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await mount(documentName);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(box.current!.phase).toBe("done");
    expect(box.current!.lines).toHaveLength(1);
    expect(box.current!.hasTranscript).toBe(true);
  });
});

describe("notebook tab switch: remounting by key resets state (Fix 1A)", () => {
  it("without a key, a documentName change on the same instance keeps the old tab's state (the bug)", async () => {
    window.localStorage.setItem(
      backupKey("doc-tab-a"),
      JSON.stringify({ id: "rA", link: "l", aiEnabled: true, captureMode: "desktop" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ status: "Recording", channels: ["mic"], recordedSeconds: 5, lines: [], speakers: {} })),
    );

    await mountDriver("doc-tab-a", false);
    expect(box.current!.phase).toBe("recording");
    expect(box.current!.recordingId).toBe("rA");

    await switchDocument("doc-tab-b");
    // doc-tab-b has no backup of its own; a fresh mount would be idle with no
    // recording id. Unkeyed, the pickup effect's `claimed.current` guard
    // bails out instead of re-claiming, so doc-tab-a's state leaks through.
    expect(box.current!.phase).toBe("recording");
    expect(box.current!.recordingId).toBe("rA");
  });

  it("keyed by documentName, a tab switch remounts clean: idle, no recording id", async () => {
    window.localStorage.setItem(
      backupKey("doc-tab-c"),
      JSON.stringify({ id: "rC", link: "l", aiEnabled: true, captureMode: "desktop" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ status: "Recording", channels: ["mic"], recordedSeconds: 5, lines: [], speakers: {} })),
    );

    await mountDriver("doc-tab-c", true);
    expect(box.current!.phase).toBe("recording");
    expect(box.current!.recordingId).toBe("rC");

    await switchDocument("doc-tab-d");
    expect(box.current!.phase).toBe("idle");
    expect(box.current!.recordingId).toBeNull();
    expect(box.current!.lines).toHaveLength(0);
  });
});

describe("latestRecording pickup (Fix 1B: a finished recording reaches any viewer)", () => {
  it("adopts a Done latestRecording as this viewer's own done phase, without following read-only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonRes({
          status: "Done",
          channels: [],
          recordedSeconds: 42,
          lines: [{ at: 1, end: 2, text: "hi", speaker: "mic:1", channel: "mic" }],
          speakers: {},
        }),
      ),
    );

    await mountWithLatest("doc-done-fallback", {
      id: "rDone",
      ownerName: "Priya",
      ownerIsYou: false,
      status: "Done",
      since: new Date().toISOString(),
    });

    expect(box.current!.phase).toBe("done");
    expect(box.current!.recordingId).toBe("rDone");
    expect(box.current!.remote).toBeNull();
    // Never auto-opens on its own (specs/meeting-recording-rail.md).
    expect(box.current!.open).toBe(false);
  });

  it("follows a live latestRecording read-only, same as before this fix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ status: "Recording", channels: ["mic"], recordedSeconds: 10, lines: [], speakers: {} })),
    );

    await mountWithLatest("doc-live-fallback", {
      id: "rLive",
      ownerName: "Priya",
      ownerIsYou: false,
      status: "Recording",
      since: new Date().toISOString(),
    });

    expect(box.current!.phase).toBe("recording");
    expect(box.current!.remote).toEqual({ ownerName: "Priya", ownerIsYou: false });
    expect(box.current!.open).toBe(false);
  });
});
