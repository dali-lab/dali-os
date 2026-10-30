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
    expect(container.textContent).toContain("29 of 58 min");
    expect(container.querySelectorAll('[data-solid="true"]')).toHaveLength(24);
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

  it("drops the owner suffix while processing", () => {
    const rec = makeRec({
      phase: "processing",
      processingStage: "starting",
      remote: { ownerName: "Priya", ownerIsYou: false },
    });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).not.toContain("Priya");
    expect(container.textContent).not.toContain("another device");
    unmount();
  });

  it("names the channel on a two-channel recording", () => {
    const rec = makeRec({
      phase: "processing",
      processingStage: "transcribing",
      progress: progress({ channel: 2, channels: 2, completed: 6 }),
    });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("29 of 58 min · channel 2 of 2");
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
  it("recording: warns when no sound has been detected, and shows nothing otherwise", () => {
    const silent = mountBar(makeRec({ phase: "recording", noSound: true }));
    expect(silent.container.textContent).toContain("No sound detected");
    silent.unmount();

    const fine = mountBar(makeRec({ phase: "recording", noSound: false }));
    expect(fine.container.textContent).toBe("");
    fine.unmount();
  });

  it.each([
    ["recording", { phase: "recording" as const }],
    ["review", { phase: "review" as const }],
    ["enhanced", { phase: "done" as const, enhancedAt: "2026-10-10T00:00:00Z", reviewedAt: "2026-10-10T01:00:00Z" }],
    ["idle", { phase: "idle" as const }],
  ])("renders nothing while %s", (_name, extra) => {
    const { container, unmount } = mountBar(makeRec(extra));
    expect(container.textContent).toBe("");
    unmount();
  });
});

describe("EnhanceBar avatar stack", () => {
  it("renders whole initials at the compact size with a background ring and overlap", () => {
    const rec = makeRec({
      phase: "done",
      hasTranscript: true,
      speakerKeys: ["mic:1", "call:1"],
      speakers: { "mic:1": "u1", "call:1": "u2" },
      speakerNames: { "mic:1": "Kiran Jones", "call:1": "Maya Chen" },
    });
    const { container, unmount } = mountBar(rec);
    const kiran = container.querySelector("[aria-label='Kiran Jones']")!;
    const maya = container.querySelector("[aria-label='Maya Chen']")!;
    expect(kiran.textContent).toBe("KJ");
    expect(maya.textContent).toBe("MC");
    for (const avatar of [kiran, maya]) {
      expect(avatar.className).toContain("w-6");
      expect(avatar.className).toContain("ring-2");
      expect(avatar.className).toContain("ring-background");
    }
    expect(maya.parentElement!.className).toContain("-ml-1.5");
    unmount();
  });
});

describe("EnhanceBar failed", () => {
  const failed = (extra: Partial<UseMeetingRecording> = {}) => makeRec({ phase: "failed", ...extra });

  it("says what happened, with the server's error when there is one", () => {
    const { container, unmount } = mountBar(failed({ error: "The audio could not be decoded." }));
    expect(container.textContent).toContain("Transcription failed");
    expect(container.textContent).toContain("The audio could not be decoded.");
    unmount();
  });

  it("falls back to a generic message", () => {
    const { container, unmount } = mountBar(failed({ error: null }));
    expect(container.textContent).toContain("Something went wrong while transcribing.");
    unmount();
  });

  it("offers Try again to the driver and Discard when allowed", () => {
    const rec = failed();
    const { container, unmount } = mountBar(rec);
    click(button(container, "Try again"));
    expect(rec.retryProcessing).toHaveBeenCalledTimes(1);
    click(container.querySelector('[aria-label="Discard recording"]')!);
    expect(rec.discard).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("hides Try again for a follower or a finalized recording, and Discard without the guard", () => {
    const follower = mountBar(failed({ drives: false, canDiscard: false }));
    expect(follower.container.textContent).not.toContain("Try again");
    expect(follower.container.querySelector('[aria-label="Discard recording"]')).toBeNull();
    follower.unmount();
    const done = mountBar(failed({ finalized: true }));
    expect(done.container.textContent).not.toContain("Try again");
    done.unmount();
  });

  it("shows a viewer the text only", () => {
    const { container, unmount } = mountBar(failed({ canEdit: false }));
    expect(container.textContent).toContain("Transcription failed");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    unmount();
  });
});

describe("EnhanceBar after Enhance is undone", () => {
  const enhanced = (extra: Partial<UseMeetingRecording> = {}) =>
    makeRec({
      phase: "done",
      hasTranscript: true,
      enhancedAt: "2026-10-10T00:00:00Z",
      getNoteState: () => ({ blocks: [{ id: "p", type: "paragraph", text: "typed" }], bodyText: "typed" }),
      enhanceNotes: {
        plan: { blocks: [], actionItems: [{ text: "Send the catering quote", ownerName: null, ownerUserId: null, due: null }] },
        verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
        snapshotAt: "x",
        snapshot: [],
      },
      ...extra,
    });

  it("offers Enhance notes again when none of Enhance's lines remain and the note was never reviewed", () => {
    const rec = enhanced();
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).toContain("Transcript ready");
    click(button(container, "Enhance notes"));
    expect(rec.enhanceNow).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("stays quiet once the note was reviewed", () => {
    const { container, unmount } = mountBar(enhanced({ reviewedAt: "2026-10-10T01:00:00Z" }));
    expect(container.textContent).toBe("");
    unmount();
  });

  it("stays quiet while Enhance's action item is still a line in the note", () => {
    const rec = enhanced({
      getNoteState: () => ({ blocks: [{ id: "c", type: "checkListItem", text: "Send the catering quote" }], bodyText: "" }),
    });
    const { container, unmount } = mountBar(rec);
    expect(container.textContent).not.toContain("Transcript ready");
    unmount();
  });

  it("stays quiet when the note state is not available yet", () => {
    const { container, unmount } = mountBar(enhanced({ getNoteState: () => null }));
    expect(container.textContent).toBe("");
    unmount();
  });

  it("stays quiet after an Enhance that found no action items", () => {
    const { container, unmount } = mountBar(enhanced({ enhanceNotes: notes() }));
    expect(container.textContent).toBe("");
    unmount();
  });

  it("stays quiet after an Enhance with no action items once the transcript is inserted", () => {
    const { container, unmount } = mountBar(
      enhanced({ enhanceNotes: notes(), insertedAt: "2026-10-10T00:05:00Z" }),
    );
    expect(container.textContent).not.toContain("Transcript ready");
    expect(container.textContent).not.toContain("Insert transcript");
    unmount();
  });
});

describe("EnhanceBar review title and notes", () => {
  const withOrder = (ids: string[], extra: Partial<UseMeetingRecording> = {}) =>
    makeRec({
      phase: "done",
      pendingMarks: ["b3", "b1", "b2"].map((id) => ({ id, mark: "enhance-added" as const, type: "paragraph", text: id })),
      enhanceNotes: notes(),
      getNoteState: () => ({ blocks: ids.map((id) => ({ id, type: "paragraph", text: id })), bodyText: "" }),
      ...extra,
    });

  it("jumps to the next suggestion in document order, cycling", () => {
    const rec = withOrder(["b1", "x", "b2", "b3"]);
    const { container, unmount } = mountBar(rec);
    const title = button(container, "3 suggestions from the transcript");
    for (let i = 0; i < 4; i++) click(title);
    expect((rec.scrollToBlock as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(["b1", "b2", "b3", "b1"]);
    unmount();
  });

  it("falls back to the mark order when the note state is unavailable, and works for viewers", () => {
    const rec = withOrder([], { canEdit: false, getNoteState: () => null });
    const { container, unmount } = mountBar(rec);
    click(button(container, "3 suggestions from the transcript"));
    expect(rec.scrollToBlock).toHaveBeenCalledWith("b3");
    unmount();
  });

  it("shows the enhance error in the review and generating bars", () => {
    const review = mountBar(withOrder(["b1", "b2", "b3"], { enhanceError: "Couldn't save." }));
    expect(review.container.textContent).toContain("Couldn't save.");
    review.unmount();
    const generating = mountBar(makeRec({ phase: "done", enhanceBusy: true, enhanceError: "Couldn't save." }));
    expect(generating.container.textContent).toContain("Couldn't save.");
    generating.unmount();
    const quiet = mountBar(withOrder(["b1", "b2", "b3"]));
    expect(quiet.container.textContent).not.toContain("Couldn't save.");
    quiet.unmount();
  });
});
