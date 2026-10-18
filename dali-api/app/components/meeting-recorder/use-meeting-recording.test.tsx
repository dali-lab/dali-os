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
import type { EnhanceBlockChange, EnhanceMarkEntry, SnapshotBlock } from "./enhance-plan";
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
  onSpeakersChanged,
  getNoteState,
}: {
  documentName: string;
  latestRecording?: LatestRecording | null;
  onSpeakersChanged?: (paragraphs: string[]) => boolean;
  getNoteState?: () => { blocks: never[]; bodyText: string } | null;
}) {
  box.current = useMeetingRecording({
    documentName,
    canEdit: true,
    onInsert: () => true,
    latestRecording,
    onSpeakersChanged,
    getNoteState,
  });
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

async function mountWithLatest(
  documentName: string,
  latestRecording: LatestRecording,
  getNoteState?: () => { blocks: never[]; bodyText: string } | null,
) {
  const Stub = createRoutesStub([
    { path: "/test", Component: () => createElement(Harness, { documentName, latestRecording, getNoteState }) },
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

async function mountWithOnSpeakersChanged(documentName: string, onSpeakersChanged: (paragraphs: string[]) => boolean) {
  const Stub = createRoutesStub([
    { path: "/test", Component: () => createElement(Harness, { documentName, onSpeakersChanged }) },
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

describe("processing progress", () => {
  const progress = { stage: "transcribing", channel: 1, channels: 2, completed: 3, total: 10, audioSeconds: 90 };
  const processingBody = (extra: Record<string, unknown> = {}) => ({
    status: "Processing",
    channels: [],
    recordedSeconds: 90,
    lines: [],
    speakers: {},
    ...extra,
  });

  function stubProcessing(responses: (call: number) => Record<string, unknown>) {
    const fetchMock = vi.fn(async () => jsonRes(responses(fetchMock.mock.calls.length)));
    vi.stubGlobal("fetch", fetchMock);
  }

  function seedBackup(documentName: string) {
    window.localStorage.setItem(
      backupKey(documentName),
      JSON.stringify({ id: "rp", link: "l", aiEnabled: true, captureMode: "desktop" }),
    );
  }

  it("stores the polled progress and reports its stage", async () => {
    seedBackup("doc-progress-1");
    stubProcessing(() => processingBody({ progress }));
    await mount("doc-progress-1");
    expect(box.current!.phase).toBe("processing");
    expect(box.current!.progress).toEqual(progress);
    expect(box.current!.processingStage).toBe("transcribing");
  });

  it("reads as starting before any progress row exists", async () => {
    seedBackup("doc-progress-2");
    stubProcessing(() => processingBody({ progress: null }));
    await mount("doc-progress-2");
    expect(box.current!.progress).toBeNull();
    expect(box.current!.processingStage).toBe("starting");
  });

  it("never opens the rail for a recording that is processing", async () => {
    seedBackup("doc-progress-closed");
    stubProcessing(() => processingBody({ progress }));
    await mount("doc-progress-closed");
    expect(box.current!.phase).toBe("processing");
    expect(box.current!.open).toBe(false);
  });

  it("has no stage outside processing", async () => {
    await mount("doc-progress-3");
    expect(box.current!.processingStage).toBeNull();
  });

  it("clears progress once the recording is Done", async () => {
    seedBackup("doc-progress-4");
    stubProcessing((call) =>
      call === 1
        ? processingBody({ progress })
        : { ...processingBody({ progress }), status: "Done", lines: [], speakers: {} },
    );
    await mount("doc-progress-4");
    expect(box.current!.phase).toBe("done");
    expect(box.current!.progress).toBeNull();
    expect(box.current!.processingStage).toBeNull();
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

  it("never auto-runs Enhance in the background, for the owner or anyone else (specs/meeting-recording-rail.md Step 2: cut)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/ai/meeting-notes/enhance")) return jsonRes({ error: "unexpected" }, 500);
      return jsonRes({
        status: "Done",
        channels: [],
        recordedSeconds: 42,
        lines: [{ at: 1, end: 2, text: "hi", speaker: "mic:1", channel: "mic" }],
        speakers: {},
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountWithLatest(
      "doc-done-mine-no-autorun",
      { id: "rMine", ownerName: "You", ownerIsYou: true, status: "Done", since: new Date().toISOString() },
      () => ({ blocks: [], bodyText: "typed notes" }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(box.current!.phase).toBe("done");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/ai/meeting-notes/enhance"))).toBe(false);
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

describe("setSpeaker: onSpeakersChanged + speakersChangedAt (Fix 4: stale names after Insert/Enhance)", () => {
  function stubDoneWithInsertedAt(documentName: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonRes({
            status: "Done",
            channels: [],
            recordedSeconds: 5,
            lines: [{ at: 0, end: 1, text: "hi", speaker: "mic:1", channel: "mic" }],
            speakers: {},
            insertedAt: "2026-10-10T18:00:00Z",
          });
        }
        return jsonRes({ ok: true });
      }),
    );
    window.localStorage.setItem(backupKey(documentName), JSON.stringify({ id: "rSpk", link: "l", aiEnabled: true }));
  }

  it("calls onSpeakersChanged with the rewritten paragraphs once the transcript is already in the note", async () => {
    const documentName = "doc-speakers-inserted";
    stubDoneWithInsertedAt(documentName);
    const onSpeakersChanged = vi.fn(() => true);

    await mountWithOnSpeakersChanged(documentName, onSpeakersChanged);
    expect(box.current!.phase).toBe("done");
    expect(box.current!.insertedAt).not.toBeNull();

    await act(async () => {
      await box.current!.setSpeaker("mic:1", "u1", "Alex Kim");
    });

    expect(onSpeakersChanged).toHaveBeenCalledWith(["[00:00] Alex Kim: hi"]);
    expect(box.current!.speakersChangedAt).not.toBeNull();
  });

  it("does not call onSpeakersChanged when the transcript was never inserted or enhanced", async () => {
    const documentName = "doc-speakers-not-inserted";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonRes({
            status: "Done",
            channels: [],
            recordedSeconds: 5,
            lines: [{ at: 0, end: 1, text: "hi", speaker: "mic:1", channel: "mic" }],
            speakers: {},
          });
        }
        return jsonRes({ ok: true });
      }),
    );
    window.localStorage.setItem(backupKey(documentName), JSON.stringify({ id: "rSpk2", link: "l", aiEnabled: true }));
    const onSpeakersChanged = vi.fn(() => true);

    await mountWithOnSpeakersChanged(documentName, onSpeakersChanged);
    expect(box.current!.insertedAt).toBeNull();

    await act(async () => {
      await box.current!.setSpeaker("mic:1", "u1", "Alex Kim");
    });

    expect(onSpeakersChanged).not.toHaveBeenCalled();
    // speakersChangedAt still tracks the rename itself, independent of
    // whether the toggle needed rewriting — the "enhanced" rail copy and
    // the "ready" unnamed-speakers line both read it this way.
    expect(box.current!.speakersChangedAt).not.toBeNull();
  });

  it("rolls back speakersChangedAt along with speakers/speakerNames when the server rejects the rename", async () => {
    const documentName = "doc-speakers-rollback";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonRes({
            status: "Done",
            channels: [],
            recordedSeconds: 5,
            lines: [{ at: 0, end: 1, text: "hi", speaker: "mic:1", channel: "mic" }],
            speakers: {},
          });
        }
        return jsonRes({ error: "nope" }, 500);
      }),
    );
    window.localStorage.setItem(backupKey(documentName), JSON.stringify({ id: "rSpk3", link: "l", aiEnabled: true }));

    await mountWithOnSpeakersChanged(documentName, () => true);
    await act(async () => {
      await box.current!.setSpeaker("mic:1", "u1", "Alex Kim");
    });

    expect(box.current!.speakersChangedAt).toBeNull();
    expect(box.current!.speakers["mic:1"]).toBeUndefined();
  });
});

// ─── Inline review (specs/meeting-recording-rail.md Step 2) ────────────────
// A docChangeCb ref stands in for the route's editor.onChange wiring: the
// hook's subscribeDocumentChanges prop just hands back an unsubscribe, and
// the route is the one that actually calls back with a mark scan + change
// list (see documents.$pageId.tsx) — these tests drive that callback
// directly instead of mounting a real BlockNote editor.
const docChangeCb: {
  current: ((ctx: { marks: EnhanceMarkEntry[]; changes: EnhanceBlockChange[] }) => void) | null;
} = { current: null };

type EnhanceHarnessProps = {
  documentName: string;
  getNoteState?: () => { blocks: SnapshotBlock[]; bodyText: string } | null;
  onApplyEnhance?: (
    ops: never[],
    recordingId: string,
    transcript: string[],
    actionItems: never[],
  ) => { ok: boolean; priorBlocks?: Record<string, unknown> };
  onKeepBlock?: (id: string) => void;
  onRevertBlock?: (id: string, priorBlocks: Record<string, unknown>) => void;
  onKeepAllBlocks?: () => number;
  onRevertAllBlocks?: (priorBlocks: Record<string, unknown>) => number;
};

function EnhanceHarness(props: EnhanceHarnessProps) {
  box.current = useMeetingRecording({
    documentName: props.documentName,
    canEdit: true,
    onInsert: () => true,
    getNoteState: props.getNoteState,
    onApplyEnhance: props.onApplyEnhance as never,
    subscribeDocumentChanges: (cb) => {
      docChangeCb.current = cb;
      return () => {
        docChangeCb.current = null;
      };
    },
    onKeepBlock: props.onKeepBlock,
    onRevertBlock: props.onRevertBlock,
    onKeepAllBlocks: props.onKeepAllBlocks,
    onRevertAllBlocks: props.onRevertAllBlocks,
  });
  return null;
}

async function mountEnhanceHarness(props: EnhanceHarnessProps) {
  const Stub = createRoutesStub([{ path: "/test", Component: () => createElement(EnhanceHarness, props) }]);
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

function doneRecordingGet() {
  return jsonRes({
    status: "Done",
    channels: [],
    recordedSeconds: 10,
    lines: [{ at: 0, end: 1, text: "hi", speaker: "mic:1", channel: "mic" }],
    speakers: {},
  });
}

describe("useMeetingRecording inline review: pendingMarks subscription + Keep/Revert", () => {
  it("adopts the document's reserved-mark scan as pendingMarks", async () => {
    await mountEnhanceHarness({ documentName: "doc-marks-1" });
    expect(box.current!.pendingMarks).toEqual([]);

    const marks: EnhanceMarkEntry[] = [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }];
    act(() => {
      docChangeCb.current?.({ marks, changes: [] });
    });

    expect(box.current!.pendingMarks).toEqual(marks);
  });

  it("keepBlock/revertBlock delegate to the route's onKeepBlock/onRevertBlock with the recording's priorBlocks", async () => {
    const onKeepBlock = vi.fn();
    const onRevertBlock = vi.fn();
    await mountEnhanceHarness({ documentName: "doc-marks-2", onKeepBlock, onRevertBlock });

    act(() => {
      box.current!.keepBlock("b1");
      box.current!.revertBlock("b2");
    });

    expect(onKeepBlock).toHaveBeenCalledWith("b1");
    // enhanceNotes is null in this harness, so priorBlocks falls back to {}.
    expect(onRevertBlock).toHaveBeenCalledWith("b2", {});
  });

  it("keepAll/revertAll announce the count and return it", async () => {
    const onKeepAllBlocks = vi.fn(() => 3);
    const onRevertAllBlocks = vi.fn(() => 1);
    await mountEnhanceHarness({ documentName: "doc-marks-3", onKeepAllBlocks, onRevertAllBlocks });

    let kept = 0;
    act(() => {
      kept = box.current!.keepAll();
    });
    expect(kept).toBe(3);
    expect(box.current!.reviewAnnouncement).toBe("Kept 3 changes.");

    let reverted = 0;
    act(() => {
      reverted = box.current!.revertAll();
    });
    expect(reverted).toBe(1);
    expect(box.current!.reviewAnnouncement).toBe("Reverted 1 change.");
  });

  it("does not announce when nothing was kept or reverted", async () => {
    await mountEnhanceHarness({
      documentName: "doc-marks-4",
      onKeepAllBlocks: () => 0,
      onRevertAllBlocks: () => 0,
    });
    act(() => {
      box.current!.keepAll();
    });
    expect(box.current!.reviewAnnouncement).toBeNull();
  });

  it("posts {action: reviewed} once the last mark clears, and not again on a later no-op scan", async () => {
    window.localStorage.setItem(backupKey("doc-marks-5"), JSON.stringify({ id: "r5", link: "l", aiEnabled: true }));
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") return doneRecordingGet();
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        posted.push(body);
        return jsonRes({ ok: true, reviewedAt: "2026-01-02T00:00:00Z" });
      }),
    );
    await mountEnhanceHarness({ documentName: "doc-marks-5" });
    expect(box.current!.recordingId).toBe("r5");

    const marks: EnhanceMarkEntry[] = [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }];
    act(() => {
      docChangeCb.current?.({ marks, changes: [] });
    });
    expect(box.current!.pendingMarks).toHaveLength(1);

    await act(async () => {
      docChangeCb.current?.({ marks: [], changes: [] });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(box.current!.pendingMarks).toEqual([]);
    expect(posted.filter((b) => b.action === "reviewed")).toHaveLength(1);
    expect(box.current!.reviewedAt).toBe("2026-01-02T00:00:00Z");

    // A later scan that's still empty (e.g. an unrelated remote edit) must
    // not post a second "reviewed" — there was no 1-to-0 transition this time.
    await act(async () => {
      docChangeCb.current?.({ marks: [], changes: [] });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(posted.filter((b) => b.action === "reviewed")).toHaveLength(1);
  });

  it("does not post reviewed when an undo/redo clears the last mark", async () => {
    window.localStorage.setItem(backupKey("doc-marks-undo"), JSON.stringify({ id: "r7", link: "l", aiEnabled: true }));
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") return doneRecordingGet();
        posted.push(init?.body ? JSON.parse(String(init.body)) : {});
        return jsonRes({ ok: true, reviewedAt: "2026-01-02T00:00:00Z" });
      }),
    );
    await mountEnhanceHarness({ documentName: "doc-marks-undo" });

    const marks: EnhanceMarkEntry[] = [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }];
    act(() => {
      docChangeCb.current?.({ marks, changes: [] });
    });
    await act(async () => {
      docChangeCb.current?.({
        marks: [],
        changes: [{ type: "update", source: { type: "undo-redo" }, block: { id: "b1", props: {} }, prevBlock: { id: "b1", props: { backgroundColor: "enhance-added" } } }],
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(box.current!.pendingMarks).toEqual([]);
    expect(posted.filter((b) => b.action === "reviewed")).toHaveLength(0);
    expect(box.current!.reviewedAt).toBeNull();
  });

  it("still posts reviewed when a local Keep clears the last mark", async () => {
    window.localStorage.setItem(backupKey("doc-marks-keep"), JSON.stringify({ id: "r8", link: "l", aiEnabled: true }));
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") return doneRecordingGet();
        posted.push(init?.body ? JSON.parse(String(init.body)) : {});
        return jsonRes({ ok: true, reviewedAt: "2026-01-02T00:00:00Z" });
      }),
    );
    await mountEnhanceHarness({ documentName: "doc-marks-keep", onKeepBlock: vi.fn() });

    const marks: EnhanceMarkEntry[] = [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }];
    act(() => {
      docChangeCb.current?.({ marks, changes: [] });
    });
    await act(async () => {
      docChangeCb.current?.({
        marks,
        changes: [{ type: "update", source: { type: "local" }, block: { id: "b1", props: { backgroundColor: "enhance-added" } }, prevBlock: { id: "b1", props: { backgroundColor: "enhance-added" } } }],
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(posted.filter((b) => b.action === "reviewed")).toHaveLength(1);
  });

  it("a local edit on an already-marked block clears it via onKeepBlock, without the enhance-apply transaction itself triggering a false Keep", async () => {
    const onKeepBlock = vi.fn();
    await mountEnhanceHarness({ documentName: "doc-marks-6", onKeepBlock });

    const marks: EnhanceMarkEntry[] = [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }];
    // The write that FIRST marks b1: prevBlock carries no mark yet, so this
    // must not be treated as a local-edit Keep.
    act(() => {
      docChangeCb.current?.({
        marks,
        changes: [
          { type: "update", source: { type: "local" }, block: { id: "b1", props: { backgroundColor: "enhance-added" } }, prevBlock: { id: "b1", props: {} } },
        ],
      });
    });
    expect(onKeepBlock).not.toHaveBeenCalled();
    expect(box.current!.pendingMarks).toEqual(marks);

    // A later edit to that SAME already-marked block: prevBlock now carries
    // the mark too — this is the real "typed into a marked block" case.
    act(() => {
      docChangeCb.current?.({
        marks,
        changes: [
          {
            type: "update",
            source: { type: "local" },
            block: { id: "b1", props: { backgroundColor: "enhance-added" } },
            prevBlock: { id: "b1", props: { backgroundColor: "enhance-added" } },
          },
        ],
      });
    });
    expect(onKeepBlock).toHaveBeenCalledWith("b1");
  });
});

describe("useMeetingRecording.enhanceNow (specs/meeting-recording-rail.md Step 2: preview is a write)", () => {
  function stubEnhanceFlow(posted: { url: string; body: Record<string, unknown> }[]) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET") return doneRecordingGet();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      posted.push({ url, body });
      if (url.includes("/api/ai/meeting-notes/enhance")) {
        return jsonRes({
          plan: { blocks: [], actionItems: [] },
          verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
          snapshotAt: "2026-01-01T00:00:00Z",
          snapshot: [],
        });
      }
      if (url.includes("/api/collab/versions")) return jsonRes({ ok: true });
      return jsonRes({ ok: true, enhancedAt: "2026-01-01T00:05:00Z", enhancedBy: "Ada" });
    });
  }

  it("bumps noteVersion once per frame however many document changes arrive", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      await mountEnhanceHarness({ documentName: "doc-version", getNoteState: () => null });
      expect(box.current!.noteVersion).toBe(0);
      act(() => {
        for (let i = 0; i < 5; i++) docChangeCb.current!({ marks: [], changes: [] });
      });
      expect(box.current!.noteVersion).toBe(0);
      act(() => {
        vi.advanceTimersByTime(40);
      });
      expect(box.current!.noteVersion).toBe(1);
      act(() => {
        docChangeCb.current!({ marks: [], changes: [] });
        vi.advanceTimersByTime(40);
      });
      expect(box.current!.noteVersion).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("generates, locks, applies, and persists priorBlocks from onApplyEnhance's result in a follow-up call", async () => {
    window.localStorage.setItem(backupKey("doc-enhance-1"), JSON.stringify({ id: "r1", link: "l", aiEnabled: true }));
    const posted: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", stubEnhanceFlow(posted));
    const onApplyEnhance = vi.fn(() => ({ ok: true, priorBlocks: { b1: { id: "b1" } } }));

    await mountEnhanceHarness({
      documentName: "doc-enhance-1",
      getNoteState: () => ({ blocks: [], bodyText: "" }),
      onApplyEnhance,
    });
    expect(box.current!.recordingId).toBe("r1");

    await act(async () => {
      await box.current!.enhanceNow();
    });

    expect(onApplyEnhance).toHaveBeenCalled();
    expect(box.current!.enhancedAt).toBe("2026-01-01T00:05:00Z");
    expect(box.current!.enhancedByName).toBe("Ada");

    const lockPosts = posted.filter((p) => p.url.includes("/api/meeting-recordings/r1") && p.body.action === "enhanced");
    expect(lockPosts).toHaveLength(2);
    expect(lockPosts[0]!.body.priorBlocks).toBeUndefined();
    expect(lockPosts[1]!.body.priorBlocks).toEqual({ b1: { id: "b1" } });
  });

  it("sends hasMarks:true to the generate endpoint while a mark is already pending", async () => {
    window.localStorage.setItem(backupKey("doc-enhance-2"), JSON.stringify({ id: "r2", link: "l", aiEnabled: true }));
    const posted: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", stubEnhanceFlow(posted));
    const onApplyEnhance = vi.fn(() => ({ ok: true }));

    await mountEnhanceHarness({
      documentName: "doc-enhance-2",
      getNoteState: () => ({ blocks: [], bodyText: "" }),
      onApplyEnhance,
    });

    act(() => {
      docChangeCb.current?.({ marks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }], changes: [] });
    });
    expect(box.current!.pendingMarks).toHaveLength(1);

    await act(async () => {
      await box.current!.enhanceNow();
    });

    const genPost = posted.find((p) => p.url.includes("/api/ai/meeting-notes/enhance"));
    expect(genPost?.body.hasMarks).toBe(true);
  });

  it("sets stalePreview on a 409 from the enhanced lock, without calling onApplyEnhance", async () => {
    window.localStorage.setItem(backupKey("doc-enhance-3"), JSON.stringify({ id: "r3", link: "l", aiEnabled: true }));
    const onApplyEnhance = vi.fn(() => ({ ok: true }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "GET") return doneRecordingGet();
        if (url.includes("/api/ai/meeting-notes/enhance")) {
          return jsonRes({
            plan: { blocks: [], actionItems: [] },
            verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
            snapshotAt: "2026-01-01T00:00:00Z",
            snapshot: [],
          });
        }
        if (url.includes("/api/collab/versions")) return jsonRes({ ok: true });
        return jsonRes({ error: "stale" }, 409);
      }),
    );

    await mountEnhanceHarness({
      documentName: "doc-enhance-3",
      getNoteState: () => ({ blocks: [], bodyText: "" }),
      onApplyEnhance,
    });

    await act(async () => {
      await box.current!.enhanceNow();
    });

    expect(box.current!.stalePreview).toBe(true);
    expect(onApplyEnhance).not.toHaveBeenCalled();
  });

  it("cancelEnhanceGenerating stops the run short of writing, even though the in-flight generate call still resolves", async () => {
    window.localStorage.setItem(backupKey("doc-enhance-4"), JSON.stringify({ id: "r4", link: "l", aiEnabled: true }));
    const onApplyEnhance = vi.fn(() => ({ ok: true }));
    let resolveGenerate!: (res: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "GET") return doneRecordingGet();
        if (url.includes("/api/ai/meeting-notes/enhance")) {
          return new Promise<Response>((resolve) => {
            resolveGenerate = resolve;
          });
        }
        return jsonRes({ ok: true });
      }),
    );

    await mountEnhanceHarness({
      documentName: "doc-enhance-4",
      getNoteState: () => ({ blocks: [], bodyText: "" }),
      onApplyEnhance,
    });

    let settled = false;
    act(() => {
      void box.current!.enhanceNow().then(() => (settled = true));
    });
    expect(box.current!.enhanceBusy).toBe(true);

    act(() => {
      box.current!.cancelEnhanceGenerating();
    });
    expect(box.current!.enhanceBusy).toBe(false);

    await act(async () => {
      resolveGenerate(
        jsonRes({
          plan: { blocks: [], actionItems: [] },
          verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
          snapshotAt: "2026-01-01T00:00:00Z",
          snapshot: [],
        }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(settled).toBe(true);
    expect(onApplyEnhance).not.toHaveBeenCalled();
    expect(box.current!.enhancedAt).toBeNull();
    expect(box.current!.enhanceBusy).toBe(false);
  });
});
