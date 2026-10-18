// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act } from "react";
import { EnhanceBar } from "./EnhanceBar";
import { makeRec, mountDom } from "./test-support";
import type { UseMeetingRecording } from "./use-meeting-recording";
import type { RecordingProgress } from "./types";

afterEach(() => {
  document.body.innerHTML = "";
});

function mountBar(rec: UseMeetingRecording) {
  return mountDom(createElement(EnhanceBar, { rec }));
}

function button(container: ParentNode, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const progress = (extra: Partial<RecordingProgress>): RecordingProgress => ({
  stage: "transcribing",
  channel: 1,
  channels: 1,
  completed: 0,
  total: 12,
  audioSeconds: 3480,
  ...extra,
});

const marks = [
  { id: "b1", mark: "enhance-added" as const, type: "paragraph", text: "x" },
  { id: "b2", mark: "enhance-added" as const, type: "paragraph", text: "y" },
];

const notes = (verified = { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 }) => ({
  plan: { blocks: [], actionItems: [] },
  verified,
  snapshotAt: "x",
  snapshot: [],
});

describe("EnhanceBar processing", () => {
  it("starting", () => {
    const { container, unmount } = mountBar(makeRec({ phase: "processing", processingStage: "starting" }));
    expect(container.textContent).toContain("Starting up");
    expect(container.textContent).toContain("Getting the transcriber ready");
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(60);
    unmount();
  });

  it("fetching", () => {
    const rec = makeRec({
      phase: "processing",
      processingStage: "fetching",
      progress: progress({ stage: "fetching", completed: 2, total: 5 }),
    });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("Preparing audio");
    expect(container.textContent).toContain("2 of 5 parts");
    unmount();
  });

  it("transcribing counts minutes from completed windows", () => {
    const rec = makeRec({ phase: "processing", processingStage: "transcribing", progress: progress({ completed: 6 }) });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("Transcribing");
    expect(container.textContent).toContain("30 of 58 min");
    expect(container.querySelectorAll('[data-solid="true"]')).toHaveLength(30);
    unmount();
  });

  it("labeling shows the percent and the sweep", () => {
    const rec = makeRec({
      phase: "processing",
      processingStage: "labeling",
      progress: progress({ stage: "labeling", completed: 4, total: 5 }),
    });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("Labeling speakers");
    expect(container.textContent).toContain("Finding who spoke when · 80%");
    expect(container.querySelector("[data-sweep]")).not.toBeNull();
    unmount();
  });

  it("offers Discard to Core only", () => {
    const withDiscard = mountBar(makeRec({ phase: "processing", processingStage: "starting", canDiscard: true }));
    expect(withDiscard.container.querySelector('[aria-label="Discard recording"]')).not.toBeNull();
    withDiscard.unmount();
    const without = mountBar(makeRec({ phase: "processing", processingStage: "starting", canDiscard: false }));
    expect(without.container.querySelector('[aria-label="Discard recording"]')).toBeNull();
    without.unmount();
  });

  it("names the owner to a follower", () => {
    const rec = makeRec({
      phase: "processing",
      processingStage: "starting",
      remote: { ownerName: "Priya", ownerIsYou: false },
    });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("· Priya");
    unmount();
  });
});

describe("EnhanceBar ready", () => {
  const ready = (extra: Partial<UseMeetingRecording> = {}) =>
    makeRec({
      phase: "done",
      hasTranscript: true,
      recordedSeconds: 3480,
      speakerKeys: ["mic:1", "call:1", "call:2"],
      speakers: { "mic:1": "u1" },
      speakerNames: { "mic:1": "Kiran Jones" },
      ...extra,
    });

  it("shows duration, speaker count and the avatar stack", () => {
    const { container, unmount } = mountBar(ready());
    expect(container.textContent).toContain("Transcript ready");
    expect(container.textContent).toContain("58 min · 3 speakers");
    expect(container.querySelectorAll("[aria-label='Kiran Jones']").length).toBeGreaterThan(0);
    unmount();
  });

  it("Enhance notes calls enhanceNow; Insert transcript stays available", () => {
    const rec = ready();
    const { container, unmount } = mountBar(rec);
    click(button(container, "Enhance notes"));
    expect(rec.enhanceNow).toHaveBeenCalledTimes(1);
    click(button(container, "Insert transcript"));
    expect(rec.insert).toHaveBeenCalledWith(null);
    unmount();
  });

  it("labels the primary Write notes on an untouched note", () => {
    const { container, unmount } = mountBar(ready({ currentlyUntouched: vi.fn(() => true) }));
    expect(button(container, "Write notes")).toBeTruthy();
    unmount();
  });

  it("with AI off, Insert transcript is the only action", () => {
    const rec = ready({ aiEnabled: false });
    const { container, unmount } = mountBar(rec);
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent === "Insert transcript")).toHaveLength(1);
    click(button(container, "Insert transcript"));
    expect(rec.insert).toHaveBeenCalledWith(null);
    expect(rec.enhanceNow).not.toHaveBeenCalled();
    unmount();
  });

  it("disables Enhance while busy or without a transcript", () => {
    const { container, unmount } = mountBar(ready({ busy: true }));
    expect(button(container, "Enhance notes").disabled).toBe(true);
    unmount();
  });

  it("renders nothing for a viewer who cannot edit", () => {
    const { container, unmount } = mountBar(ready({ canEdit: false }));
    expect(container.textContent).toBe("");
    unmount();
  });

  it("inserted: offers Enhance notes only when AI is on", () => {
    const on = mountBar(ready({ insertedAt: "2026-10-10T00:00:00Z" }));
    expect(on.container.textContent).toContain("Transcript inserted");
    expect(button(on.container, "Enhance notes")).toBeTruthy();
    on.unmount();
    const off = mountBar(ready({ insertedAt: "2026-10-10T00:00:00Z", aiEnabled: false }));
    expect(off.container.textContent).toBe("");
    off.unmount();
  });
});

describe("EnhanceBar generating and stale", () => {
  it("generating: copy and Cancel", () => {
    const rec = makeRec({ phase: "done", enhanceBusy: true });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("Enhancing");
    expect(container.textContent).toContain("Reading your notes and the transcript");
    click(button(container, "Cancel"));
    expect(rec.cancelEnhanceGenerating).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("stalePreview: existing copy and actions", () => {
    const rec = makeRec({ phase: "done", stalePreview: true });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("Someone enhanced this note after your preview.");
    click(button(container, "Cancel"));
    expect(rec.dismissStalePreview).toHaveBeenCalled();
    click(button(container, "Reload preview"));
    expect(rec.reloadStalePreview).toHaveBeenCalled();
    unmount();
  });
});

describe("EnhanceBar pending review", () => {
  const pending = (extra: Partial<UseMeetingRecording> = {}) =>
    makeRec({ phase: "done", pendingMarks: marks, enhanceNotes: notes(), ...extra });

  it("counts suggestions and shows the hint", () => {
    const { container, unmount } = mountBar(pending());
    expect(container.textContent).toContain("2 suggestions from the transcript");
    expect(container.textContent).toContain("Edit any line to keep it. Your own lines stay as typed.");
    unmount();
  });

  it("singular for one", () => {
    const { container, unmount } = mountBar(pending({ pendingMarks: marks.slice(0, 1) }));
    expect(container.textContent).toContain("1 suggestion from the transcript");
    unmount();
  });

  it("Keep all and Revert all call the rec", () => {
    const rec = pending();
    const { container, unmount } = mountBar(rec);
    click(button(container, "Keep all"));
    expect(rec.keepAll).toHaveBeenCalledTimes(1);
    click(button(container, "Revert all"));
    expect(rec.revertAll).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("the menu offers Enhance again and, for Core, Discard", () => {
    const rec = pending({ canDiscard: true });
    const { unmount } = mountBar(rec);
    act(() => {
      (document.querySelector('[aria-label="More"]') as HTMLElement).click();
    });
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual([
      "Enhance againRebuilds the notes from the current text and the transcript.",
      "Discard recording",
    ]);
    act(() => {
      (items[0] as HTMLElement).click();
    });
    expect(rec.revertAllAndEnhanceAgain).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("the menu hides Discard without the guard", () => {
    const { unmount } = mountBar(pending({ canDiscard: false }));
    act(() => {
      (document.querySelector('[aria-label="More"]') as HTMLElement).click();
    });
    expect([...document.querySelectorAll('[role="menuitem"]')]).toHaveLength(1);
    unmount();
  });

  it("a viewer who cannot edit sees the count and no actions", () => {
    const { container, unmount } = mountBar(pending({ canEdit: false }));
    expect(container.textContent).toContain("2 suggestions from the transcript");
    expect(container.textContent).not.toContain("Keep all");
    expect(container.textContent).not.toContain("Edit any line");
    expect(container.querySelector('[aria-label="More"]')).toBeNull();
    unmount();
  });

  it("shows the dropped and skipped caveats only when present", () => {
    const quiet = mountBar(pending());
    expect(quiet.container.textContent).not.toContain("couldn't be verified");
    expect(quiet.container.textContent).not.toContain("left as typed");
    quiet.unmount();

    const rec = pending({
      enhanceNotes: notes({ droppedBlocks: 2, droppedCites: 1, unmatchedOwners: 0 }),
      enhanceSkipped: 1,
    });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("2 additions couldn't be verified against the transcript and were left out.");
    expect(container.textContent).toContain("1 citation didn't match the transcript and was dropped.");
    expect(container.textContent).toContain("1 block changed while this ran and was left as typed.");
    unmount();
  });
});

describe("EnhanceBar other states", () => {
  it.each([
    ["recording", { phase: "recording" as const }],
    ["review", { phase: "review" as const }],
    ["failed", { phase: "failed" as const }],
    ["enhanced", { phase: "done" as const, enhancedAt: "2026-10-10T00:00:00Z" }],
    ["idle", { phase: "idle" as const }],
  ])("renders nothing while %s", (_name, extra) => {
    const { container, unmount } = mountBar(makeRec(extra));
    expect(container.textContent).toBe("");
    unmount();
  });
});
