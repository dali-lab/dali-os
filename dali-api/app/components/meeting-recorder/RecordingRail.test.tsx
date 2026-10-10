// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordingRail, deriveRailState } from "./RecordingRail";
import type { UseMeetingRecording } from "./use-meeting-recording";

function makeRec(overrides: Partial<UseMeetingRecording> = {}): UseMeetingRecording {
  const base: UseMeetingRecording = {
    canEdit: true,
    isCore: false,
    roster: [],
    projectId: null,
    canCreateTasks: false,
    getNoteState: () => null,
    seededFromPageId: null,
    seededTemplateHash: null,

    phase: "idle",
    open: true,
    setOpen: vi.fn(),
    recordingId: "rec-1",
    link: null,
    aiEnabled: true,
    captureMode: "browser",
    appUnreachable: false,
    desktopVer: null,
    channelsActive: ["mic"],
    levels: { mic: 0, call: 0 },
    stalled: { mic: false, call: false },
    recordedSeconds: 724,
    now: 0,
    lines: [],
    speakers: {},
    error: null,
    busy: false,
    remote: null,
    insertedAt: null,
    finalized: false,
    stoppingSince: 0,

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
    hasTranscript: false,
    drives: true,
    canDiscard: true,
    stopStuck: false,
    elapsed: 724,
    speakerCounts: { mic: 0, call: 0 },
    speakerKeys: [],
    sortedLines: [],
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

function render(rec: UseMeetingRecording): string {
  return renderToStaticMarkup(createElement(RecordingRail, { rec }));
}

describe("deriveRailState", () => {
  it("maps live/terminal phases 1:1 and returns null while idle", () => {
    expect(deriveRailState(makeRec({ phase: "idle" }))).toBeNull();
    expect(deriveRailState(makeRec({ phase: "recording" }))).toBe("recording");
    expect(deriveRailState(makeRec({ phase: "failed" }))).toBe("failed");
  });

  it("splits phase 'done' into ready/generating/preview/enhanced/inserted/stalePreview", () => {
    const done = { phase: "done" as const };
    expect(deriveRailState(makeRec({ ...done }))).toBe("ready");
    expect(deriveRailState(makeRec({ ...done, enhancedAt: "2026-10-10T00:00:00Z" }))).toBe("enhanced");
    expect(deriveRailState(makeRec({ ...done, enhanceSheetOpen: true }))).toBe("generating");
    expect(
      deriveRailState(
        makeRec({ ...done, enhanceSheetOpen: true, enhanceNotes: { plan: { blocks: [], actionItems: [] }, verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 }, snapshotAt: "x", snapshot: [] } }),
      ),
    ).toBe("preview");
    expect(deriveRailState(makeRec({ ...done, insertedAt: "2026-10-10T00:00:00Z" }))).toBe("inserted");
    expect(deriveRailState(makeRec({ ...done, stalePreview: true }))).toBe("stalePreview");
    // insertedAt wins even once enhanced/stale — "inserted" is terminal.
    expect(deriveRailState(makeRec({ ...done, insertedAt: "x", enhancedAt: "y", stalePreview: true }))).toBe("inserted");
  });
});

describe("RecordingRail per state (specs/meeting-recording-rail.md state table)", () => {
  it("idle: renders nothing (the start sheet, not the rail, handles it)", () => {
    expect(render(makeRec({ phase: "idle" }))).toBe("");
  });

  it("starting (desktop, within 30s): status line only, Cancel secondary, no primary chrome", () => {
    const html = render(makeRec({ phase: "starting", captureMode: "desktop", appUnreachable: false }));
    expect(html).toContain("Opening the DALI OS app…");
    expect(html).toContain(">Cancel<");
    expect(html).not.toContain("Get the app");
  });

  it("starting (desktop, after 30s): app-didn't-respond copy, Record in this browser primary, Cancel + Get the app secondaries", () => {
    const html = render(makeRec({ phase: "starting", captureMode: "desktop", appUnreachable: true }));
    expect(html).toContain("The DALI OS app didn&#x27;t respond.");
    expect(html).toContain("Update the DALI OS app, or record in this browser.");
    expect(html).toContain("Record in this browser instead");
    expect(html).toContain("Get the app");
    expect(html).toContain('aria-label="Cancel"');
  });

  it("recording: red-dot timer status, channel body, Stop primary, no secondary", () => {
    const html = render(makeRec({ phase: "recording", captureMode: "browser", channelsActive: ["mic", "call"], elapsed: 724 }));
    expect(html).toContain("12:04");
    expect(html).toContain("Microphone · Call audio");
    expect(html).toContain("Type rough notes in the note; Enhance fills them in after you stop.");
    expect(html).toContain("Stop</button>");
  });

  it("stopping (not stuck): just the status line, no actions", () => {
    const html = render(makeRec({ phase: "stopping", stopStuck: false }));
    expect(html).toContain("Stopping…");
    expect(html).not.toContain("Transcribe anyway");
    expect(html).not.toContain("Discard recording");
  });

  it("stopping (stuck after 60s): app-may-have-quit copy, Transcribe anyway primary, Discard secondary", () => {
    const html = render(makeRec({ phase: "stopping", stopStuck: true }));
    expect(html).toContain("The DALI OS app hasn&#x27;t confirmed the stop.");
    expect(html).toContain("The app may have quit before it finished uploading.");
    expect(html).toContain("Transcribe anyway");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("review: recorded+transcribing-starts status, Continue + Discard secondaries, Transcribe primary", () => {
    const html = render(makeRec({ phase: "review", recordedSeconds: 724 }));
    expect(html).toContain("12:04 recorded. Transcribing starts when you finish.");
    expect(html).toContain("Continue");
    expect(html).toContain('aria-label="Discard recording"');
    expect(html).toContain(">Transcribe<");
  });

  it("review (reload recovery): the recovery sentence shows as body", () => {
    const html = render(makeRec({ phase: "review", error: "Recording stopped when this page reloaded. Continue to pick it up." }));
    expect(html).toContain("Recording stopped when this page reloaded. Continue to pick it up.");
  });

  it("processing: status line, Discard only, no primary", () => {
    const html = render(makeRec({ phase: "processing" }));
    expect(html).toContain("Transcribing and labeling speakers. Usually a few minutes.");
    expect(html).toContain('aria-label="Discard recording"');
    expect(html).not.toContain("Try again");
  });

  it("failed: shows the error, Try again primary (not finalized), Discard secondary", () => {
    const html = render(makeRec({ phase: "failed", error: "Transcription failed.", finalized: false }));
    expect(html).toContain("Transcription failed.");
    expect(html).toContain("Try again");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("failed (finalized): Try again is hidden once the audio is gone", () => {
    const html = render(makeRec({ phase: "failed", error: "Transcription failed.", finalized: true }));
    expect(html).not.toContain("Try again");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("ready: speaker-count status, AI-on secondaries (Insert transcript, Discard), Enhance notes primary", () => {
    const html = render(
      makeRec({ phase: "done", lines: [{ at: 0, end: 1, text: "hi", speaker: "mic:1", channel: "mic" } as never], speakerKeys: ["mic:1"], aiEnabled: true }),
    );
    expect(html).toContain("Transcript ready. 1 speaker.");
    expect(html).toContain("Insert transcript");
    expect(html).toContain("Enhance notes");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("ready (AI off): Insert transcript is the primary, no duplicate secondary", () => {
    const html = render(makeRec({ phase: "done", aiEnabled: false, hasTranscript: true }));
    expect(html).toContain("Transcript ready.");
    const matches = html.match(/Insert transcript/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("generating: reading-notes status, Cancel secondary, no primary", () => {
    const html = render(makeRec({ phase: "done", enhanceSheetOpen: true, enhanceNotes: null }));
    expect(html).toContain("Reading your notes and the transcript…");
    expect(html).toContain(">Cancel<");
    expect(html).not.toContain(">Apply<");
  });

  it("preview: preview-counts status, Apply primary, Cancel secondary", () => {
    const html = render(
      makeRec({
        phase: "done",
        enhanceSheetOpen: true,
        enhanceNotes: {
          plan: { blocks: [], actionItems: [] },
          verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
          snapshotAt: "x",
          snapshot: [],
        },
      }),
    );
    expect(html).toContain("Preview: 0 blocks changed, 0 added.");
    expect(html).toContain(">Apply<");
    expect(html).toContain(">Cancel<");
  });

  it("enhanced: enhanced-by status, Enhance again primary, Discard secondary", () => {
    const html = render(makeRec({ phase: "done", enhancedAt: "2026-10-10T18:14:00Z", enhancedByName: "Ada", hasTranscript: true }));
    expect(html).toContain("Enhanced");
    expect(html).toContain("by Ada");
    expect(html).toContain("Enhance again rebuilds the notes from the current text and the transcript.");
    expect(html).toContain("Enhance again");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("inserted: already-inserted status, no primary, Discard secondary only", () => {
    const html = render(makeRec({ phase: "done", insertedAt: "2026-10-10T18:14:00Z", hasTranscript: true }));
    expect(html).toContain("Already in this note. Discarding only removes the recording, not what was inserted.");
    expect(html).not.toContain("Enhance");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("stale preview: someone-else-enhanced status, Reload preview primary, Cancel secondary", () => {
    const html = render(makeRec({ phase: "done", stalePreview: true }));
    expect(html).toContain("Someone enhanced this note after your preview.");
    expect(html).toContain("Reload preview");
    expect(html).toContain(">Cancel<");
  });

  it("following someone else's recording: owner's name in the status line, no primary", () => {
    const html = render(
      makeRec({ phase: "recording", remote: { ownerName: "Priya", ownerIsYou: false }, drives: false, elapsed: 60 }),
    );
    expect(html).toContain("Recording · Priya");
    expect(html).toContain("· Priya");
    expect(html).not.toContain(">Stop<");
  });
});
