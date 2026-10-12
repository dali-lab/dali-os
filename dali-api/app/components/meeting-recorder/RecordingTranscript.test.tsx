// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RecordingTranscript } from "./RecordingTranscript";
import type { UseMeetingRecording } from "./use-meeting-recording";
import type { TranscriptLine } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeRec(overrides: Partial<UseMeetingRecording> = {}): UseMeetingRecording {
  const lines = overrides.lines ?? [];
  const base: UseMeetingRecording = {
    canEdit: true,
    isCore: false,
    roster: [],
    projectId: null,
    canCreateTasks: false,
    getNoteState: () => null,
    seededFromPageId: null,
    seededTemplateHash: null,

    phase: "done",
    open: true,
    setOpen: vi.fn(),
    recordingId: "rec-1",
    link: null,
    aiEnabled: true,
    captureMode: "browser",
    appUnreachable: false,
    desktopVer: null,
    channelsActive: [],
    levels: { mic: 0, call: 0 },
    stalled: { mic: false, call: false },
    recordedSeconds: 0,
    now: 0,
    lines,
    speakers: {},
    speakerNames: {},
    error: null,
    busy: false,
    remote: null,
    lastChunkAt: null,
    insertedAt: null,
    finalized: false,
    stoppingSince: 0,
    speakersChangedAt: null,

    enhanceNotes: null,
    enhancedAt: null,
    enhancedByName: null,
    enhanceSheetOpen: false,
    setEnhanceSheetOpen: vi.fn(),
    enhanceBusy: false,
    enhanceError: null,
    applyBusy: false,
    stalePreview: false,

    useDesktopApp: false,
    setUseDesktopApp: vi.fn(),
    micDeviceId: undefined,
    setMicDeviceId: vi.fn(),
    micDevices: [],
    micOptions: [],
    micLevel: 0,
    micPreviewError: null,
    callAudioWanted: false,
    setCallAudioWanted: vi.fn(),
    callAudioUnsupported: false,

    live: false,
    hasTranscript: lines.length > 0,
    drives: true,
    canDiscard: true,
    canStopOthers: false,
    stopStuck: false,
    elapsed: 0,
    speakerCounts: { mic: 1, call: 0 },
    speakerKeys: [...new Set(lines.filter((l) => l.speaker).map((l) => l.speaker!))],
    sortedLines: [...lines].sort((a, b) => a.at - b.at),
    highlightLineIndex: -1,
    highlightLineRef: { current: null },
    canShowRecorder: true,
    transcriptParam: null,
    atSeconds: null,
    highlightAt: null,

    startDesktop: vi.fn(),
    startBrowser: vi.fn(),
    stop: vi.fn(),
    finishAndTranscribe: vi.fn(),
    retryProcessing: vi.fn(),
    resume: vi.fn(),
    discard: vi.fn(),
    insert: vi.fn(() => true),
    currentlyUntouched: vi.fn(() => false),
    generateEnhance: vi.fn(async () => true),
    onEnhanceClick: vi.fn(async () => {}),
    reloadStalePreview: vi.fn(),
    closeEnhancePreview: vi.fn(),
    applyEnhance: vi.fn(async () => {}),
    createTasksFromItems: vi.fn(async () => true),
    setSpeaker: vi.fn(async () => {}),
    jumpToTranscript: vi.fn(),
    cancelStart: vi.fn(),
    switchToBrowserAfterUnreachable: vi.fn(),
  };
  return { ...base, ...overrides };
}

const oneSpeakerLine = (speaker: string): TranscriptLine[] => [
  { at: 0, end: 1, text: "hello there", channel: "mic", speaker } as TranscriptLine,
];

let container: HTMLDivElement;
let root: Root;

function mount(rec: UseMeetingRecording) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(RecordingTranscript, { rec })));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function chipInput(): HTMLInputElement {
  return container.querySelector("input[role='combobox']") as HTMLInputElement;
}

function chipInputs(): HTMLInputElement[] {
  return Array.from(container.querySelectorAll("input[role='combobox']"));
}

function openChip(input: HTMLInputElement = chipInput()) {
  act(() => input.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function typeInChip(value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(chipInput(), value);
    chipInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function chipOptions(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button[role='option']"));
}

// Advances the chip's debounce timer and lets the triggered fetch's promise
// chain (and the setResults it ends in) resolve, inside act() so React
// applies the resulting state update before the next assertion.
async function runDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SpeakerChip (Fix 2: pick any lab member, not just the roster)", () => {
  it("read-only (canEdit false) renders a plain label, not a control", () => {
    mount(makeRec({ canEdit: false, lines: oneSpeakerLine("mic:1") }));
    expect(container.querySelector("input[role='combobox']")).toBeNull();
    expect(container.textContent).toContain("You");
  });

  it("offers the roster first, with no member search yet for an empty query", () => {
    mount(
      makeRec({
        lines: oneSpeakerLine("mic:1"),
        roster: [{ userId: "u1", name: "Alex Kim" }],
      }),
    );
    openChip();
    const labels = chipOptions().map((o) => o.textContent ?? "");
    expect(labels[0]).toContain("Alex Kim");
    expect(labels.at(-1)).toContain("Someone else");
  });

  it("searches lab members once the typed query reaches 2 characters, debounced 200ms", async () => {
    const fetchMock = vi.fn(async () => jsonRes({ members: [{ id: "u9", name: "Priya Shah", handle: "priya" }] }));
    vi.stubGlobal("fetch", fetchMock);
    mount(makeRec({ lines: oneSpeakerLine("mic:1"), roster: [] }));

    openChip();
    typeInChip("p");
    expect(fetchMock).not.toHaveBeenCalled();
    typeInChip("pr");
    await runDebounce();

    expect(fetchMock).toHaveBeenCalledWith("/api/mentions/search?q=pr", expect.anything());
    expect(chipOptions().map((o) => o.textContent ?? "").some((t) => t.includes("Priya Shah"))).toBe(true);
  });

  it("picking a search result calls setSpeaker with the member's userId and resolved name", async () => {
    const fetchMock = vi.fn(async () => jsonRes({ members: [{ id: "u9", name: "Priya Shah", handle: "priya" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const rec = makeRec({ lines: oneSpeakerLine("mic:1"), roster: [] });
    mount(rec);

    openChip();
    typeInChip("pr");
    await runDebounce();

    const row = chipOptions().find((o) => (o.textContent ?? "").includes("Priya Shah"))!;
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(rec.setSpeaker).toHaveBeenCalledWith("mic:1", "u9", "Priya Shah");
  });

  it("'Someone else…' still reveals the inline free-text field with Save", () => {
    const rec = makeRec({ lines: oneSpeakerLine("mic:1"), roster: [{ userId: "u1", name: "Alex Kim" }] });
    mount(rec);

    openChip();
    const someoneElse = chipOptions().find((o) => (o.textContent ?? "").includes("Someone else"))!;
    act(() => someoneElse.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const textInput = container.querySelector('input[placeholder="e.g. a guest"]') as HTMLInputElement;
    expect(textInput).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(textInput, "A guest");
      textInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save")!;
    act(() => saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(rec.setSpeaker).toHaveBeenCalledWith("mic:1", "A guest");
  });

  it("the chip label prefers rec.speakerNames over a roster lookup", () => {
    mount(
      makeRec({
        lines: oneSpeakerLine("mic:1"),
        roster: [],
        speakers: { "mic:1": "u9" },
        speakerNames: { "mic:1": "Priya Shah" },
      }),
    );
    expect(container.textContent).toContain("Priya Shah");
  });
});

describe("SpeakerChip merge (Fix 3: 'Same as <speaker>')", () => {
  it("shows a 'Same as' option only for a speaker that already has an assignment", () => {
    const lines: TranscriptLine[] = [
      { at: 0, end: 1, text: "a", channel: "mic", speaker: "mic:1" } as TranscriptLine,
      { at: 1, end: 2, text: "b", channel: "mic", speaker: "mic:2" } as TranscriptLine,
    ];
    mount(
      makeRec({
        lines,
        roster: [{ userId: "u1", name: "Alex Kim" }],
        speakers: { "mic:1": "u1" },
      }),
    );

    const inputs = chipInputs();
    expect(inputs).toHaveLength(2);
    openChip(inputs[1]); // mic:2, unassigned
    const labels = chipOptions().map((o) => o.textContent ?? "");
    expect(labels.some((t) => t.includes("Same as Alex Kim"))).toBe(true);
  });

  it("does not offer 'Same as' for a speaker with no assignment yet", () => {
    const lines: TranscriptLine[] = [
      { at: 0, end: 1, text: "a", channel: "mic", speaker: "mic:1" } as TranscriptLine,
      { at: 1, end: 2, text: "b", channel: "mic", speaker: "mic:2" } as TranscriptLine,
    ];
    mount(makeRec({ lines, roster: [] }));

    openChip(chipInputs()[1]);
    const labels = chipOptions().map((o) => o.textContent ?? "");
    expect(labels.some((t) => t.includes("Same as"))).toBe(false);
  });

  it("picking 'Same as X' copies that speaker's current assignment and label onto this one", () => {
    const lines: TranscriptLine[] = [
      { at: 0, end: 1, text: "a", channel: "mic", speaker: "mic:1" } as TranscriptLine,
      { at: 1, end: 2, text: "b", channel: "mic", speaker: "mic:2" } as TranscriptLine,
    ];
    const rec = makeRec({
      lines,
      roster: [{ userId: "u1", name: "Alex Kim" }],
      speakers: { "mic:1": "u1" },
    });
    mount(rec);

    openChip(chipInputs()[1]);
    const sameAs = chipOptions().find((o) => (o.textContent ?? "").includes("Same as Alex Kim"))!;
    act(() => sameAs.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(rec.setSpeaker).toHaveBeenCalledWith("mic:2", "u1", "Alex Kim");
  });

  it("does not offer merging a speaker with itself", () => {
    const lines: TranscriptLine[] = [{ at: 0, end: 1, text: "a", channel: "mic", speaker: "mic:1" } as TranscriptLine];
    mount(makeRec({ lines, roster: [], speakers: { "mic:1": "u1" } }));

    openChip();
    const labels = chipOptions().map((o) => o.textContent ?? "");
    expect(labels.some((t) => t.includes("Same as"))).toBe(false);
  });
});

describe("SpeakerChip line counts (Fix 3: judge which to merge)", () => {
  it("shows the per-speaker line count next to a read-only chip", () => {
    const lines: TranscriptLine[] = [
      { at: 0, end: 1, text: "a", channel: "mic", speaker: "mic:1" } as TranscriptLine,
      { at: 1, end: 2, text: "b", channel: "mic", speaker: "mic:1" } as TranscriptLine,
      { at: 2, end: 3, text: "c", channel: "mic", speaker: "mic:1" } as TranscriptLine,
    ];
    mount(makeRec({ canEdit: false, lines, roster: [] }));
    expect(container.textContent).toContain("3 lines");
  });

  it("shows the per-speaker line count next to an editable chip", () => {
    const lines: TranscriptLine[] = [{ at: 0, end: 1, text: "a", channel: "mic", speaker: "mic:1" } as TranscriptLine];
    mount(makeRec({ lines, roster: [] }));
    expect(container.textContent).toContain("1 line");
    expect(container.textContent).not.toContain("1 lines");
  });
});

describe("RecordingTranscript lines (speakerNames resolution)", () => {
  it("renders the resolved speaker name next to each line", () => {
    mount(
      makeRec({
        lines: oneSpeakerLine("mic:1"),
        roster: [],
        speakers: { "mic:1": "u9" },
        speakerNames: { "mic:1": "Priya Shah" },
      }),
    );
    expect(container.textContent).toContain("Priya Shah:hello there");
  });
});
