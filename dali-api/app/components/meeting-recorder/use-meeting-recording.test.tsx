// @vitest-environment jsdom
//
// Drives the hook through phase transitions without a browser (mocked
// fetch, no real mic/capture APIs) — a Harness component mounted inside a
// react-router stub (useSearchParams/useBlocker need a real Router context)
// mirrors app/components/board/useOptimisticBoardMove.test.tsx's hook-harness
// pattern, since @testing-library isn't a dependency here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import { DialogProvider } from "~/components/ui/dialog";
import { useMeetingRecording, type UseMeetingRecording } from "./use-meeting-recording";

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

function Harness({ documentName }: { documentName: string }) {
  box.current = useMeetingRecording({ documentName, canEdit: true, onInsert: () => true });
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
