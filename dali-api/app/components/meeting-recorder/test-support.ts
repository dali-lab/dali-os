import { vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { UseMeetingRecording } from "./use-meeting-recording";

export function makeRec(overrides: Partial<UseMeetingRecording> = {}): UseMeetingRecording {
  const base: UseMeetingRecording = {
    canEdit: true,
    isCore: false,
    roster: [],
    projectId: null,
    canCreateTasks: false,
    getNoteState: () => null,
    noteVersion: 0,
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
    noSound: false,
    recordedSeconds: 724,
    now: 0,
    lines: [],
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
    enhanceBusy: false,
    enhanceError: null,
    stalePreview: false,
    pendingMarks: [],
    enhanceSkipped: 0,
    reviewedAt: null,
    reviewAnnouncement: null,
    progress: null,
    processingStage: null,

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
    canStopOthers: false,
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
    enhanceNow: vi.fn(async () => {}),
    cancelEnhanceGenerating: vi.fn(),
    reloadStalePreview: vi.fn(),
    dismissStalePreview: vi.fn(),
    revertAllAndEnhanceAgain: vi.fn(async () => {}),
    keepBlock: vi.fn(),
    revertBlock: vi.fn(),
    keepAll: vi.fn(() => 0),
    revertAll: vi.fn(() => 0),
    scrollToBlock: vi.fn(),
    createTasksFromItems: vi.fn(async () => true),
    setSpeaker: vi.fn(async () => {}),
    jumpToTranscript: vi.fn(),
    cancelStart: vi.fn(),
    switchToBrowserAfterUnreachable: vi.fn(),
  };
  return { ...base, ...overrides };
}

export function mountDom(ui: ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
