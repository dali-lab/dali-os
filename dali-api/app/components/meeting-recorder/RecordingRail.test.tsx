// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordingRail, deriveRailState } from "./RecordingRail";
import type { UseMeetingRecording } from "./use-meeting-recording";
import { makeRec } from "./test-support";

function render(rec: UseMeetingRecording): string {
  return renderToStaticMarkup(createElement(RecordingRail, { rec }));
}

describe("deriveRailState", () => {
  it("maps live/terminal phases 1:1 and returns null while idle", () => {
    expect(deriveRailState(makeRec({ phase: "idle" }))).toBeNull();
    expect(deriveRailState(makeRec({ phase: "recording" }))).toBe("recording");
    expect(deriveRailState(makeRec({ phase: "failed" }))).toBe("failed");
  });

  it("splits phase 'done' into ready/generating/pendingReview/enhanced/inserted/stalePreview", () => {
    const done = { phase: "done" as const };
    expect(deriveRailState(makeRec({ ...done }))).toBe("ready");
    expect(deriveRailState(makeRec({ ...done, enhancedAt: "2026-10-10T00:00:00Z" }))).toBe("enhanced");
    expect(deriveRailState(makeRec({ ...done, enhanceBusy: true }))).toBe("generating");
    expect(
      deriveRailState(makeRec({ ...done, pendingMarks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }] })),
    ).toBe("pendingReview");
    expect(deriveRailState(makeRec({ ...done, insertedAt: "2026-10-10T00:00:00Z" }))).toBe("inserted");
    expect(deriveRailState(makeRec({ ...done, stalePreview: true }))).toBe("stalePreview");
    // Insert is not terminal: Enhance after Insert still flows through generating/pendingReview/enhanced.
    expect(deriveRailState(makeRec({ ...done, insertedAt: "x", enhanceBusy: true }))).toBe("generating");
    expect(deriveRailState(makeRec({ ...done, insertedAt: "x", enhancedAt: "y" }))).toBe("enhanced");
    expect(deriveRailState(makeRec({ ...done, insertedAt: "x", stalePreview: true }))).toBe("stalePreview");
    // Marks present outrank an already-set enhancedAt — still something to review.
    expect(
      deriveRailState(
        makeRec({ ...done, enhancedAt: "y", pendingMarks: [{ id: "b1", mark: "enhance-prior", type: "heading", text: "" }] }),
      ),
    ).toBe("pendingReview");
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

  it("ready: shows an unnamed-speakers line under the buttons without blocking Enhance", () => {
    const html = render(
      makeRec({
        phase: "done",
        lines: [
          { at: 0, end: 1, text: "hi", speaker: "mic:1", channel: "mic" } as never,
          { at: 1, end: 2, text: "yo", speaker: "mic:2", channel: "mic" } as never,
        ],
        speakerKeys: ["mic:1", "mic:2"],
        speakers: { "mic:1": "u1" },
        aiEnabled: true,
      }),
    );
    expect(html).toContain("1 speaker unnamed. Name them first so the notes use real names.");
    expect(html).toContain("Enhance notes");
  });

  it("ready: no unnamed-speakers line once every speaker has a name", () => {
    const html = render(
      makeRec({
        phase: "done",
        lines: [{ at: 0, end: 1, text: "hi", speaker: "mic:1", channel: "mic" } as never],
        speakerKeys: ["mic:1"],
        speakers: { "mic:1": "u1" },
        aiEnabled: true,
      }),
    );
    expect(html).not.toContain("unnamed");
  });

  it("generating: reading-notes status, Cancel secondary, no primary", () => {
    const html = render(makeRec({ phase: "done", enhanceBusy: true, enhanceNotes: null }));
    expect(html).toContain("Reading your notes and the transcript…");
    expect(html).toContain(">Cancel<");
  });

  it("pendingReview: change-counts status by the enhancer, Keep all primary, Revert all + enhance-again secondaries", () => {
    const html = render(
      makeRec({
        phase: "done",
        enhancedByName: "Ada",
        pendingMarks: [
          { id: "b1", mark: "enhance-added", type: "paragraph", text: "x" },
          { id: "b2", mark: "enhance-added", type: "paragraph", text: "y" },
          { id: "b3", mark: "enhance-prior", type: "heading", text: "" },
        ],
        enhanceNotes: {
          plan: { blocks: [], actionItems: [] },
          verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
          snapshotAt: "x",
          snapshot: [],
          priorBlocks: { b1: { id: "b1" } },
        },
      }),
    );
    expect(html).toContain("Ada enhanced this note: 1 changed, 1 added, 1 removed.");
    expect(html).toContain("Keep all");
    expect(html).toContain("Revert all");
    expect(html).toContain("Revert all and enhance again");
  });

  it("pendingReview: the change list lives in the note, not the rail", () => {
    const html = render(
      makeRec({
        phase: "done",
        pendingMarks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "Interviews are behind" }],
        enhanceNotes: {
          plan: { blocks: [], actionItems: [] },
          verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
          snapshotAt: "x",
          snapshot: [],
          priorBlocks: { b1: { id: "b1", type: "paragraph", content: [{ type: "text", text: "rough", styles: {} }] } },
        },
      }),
    );
    expect(html).not.toContain("Keep change:");
    expect(html).not.toContain("Revert change:");
    expect(html).not.toContain("Was:");
    expect(html).not.toContain("Nothing left to review.");
  });

  it("pendingReview: still lists the plan's action items", () => {
    const html = render(
      makeRec({
        phase: "done",
        pendingMarks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }],
        enhanceNotes: {
          plan: {
            blocks: [],
            actionItems: [{ text: "Send the quote", ownerName: null, ownerUserId: null, due: null, dueSource: null }],
          },
          verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
          snapshotAt: "x",
          snapshot: [],
        } as never,
      }),
    );
    expect(html).toContain("Action items");
    expect(html).toContain("Send the quote");
  });

  it("pendingReview: a viewer without edit sees the status but no Keep/Revert", () => {
    const html = render(
      makeRec({
        phase: "done",
        canEdit: false,
        pendingMarks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }],
      }),
    );
    expect(html).toContain("Enhanced this note");
    expect(html).not.toContain("Keep all");
    expect(html).not.toContain("Revert all");
  });

  it("pendingReview: omits a zero count and uses singular wording for one", () => {
    const html = render(
      makeRec({
        phase: "done",
        enhancedByName: "Ada",
        pendingMarks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }],
      }),
    );
    expect(html).toContain("Ada enhanced this note: 1 added.");
    expect(html).not.toContain("changed");
    expect(html).not.toContain("removed");
  });

  it("pendingReview: appends the left-as-typed note only when blocks were skipped", () => {
    const html = render(
      makeRec({
        phase: "done",
        enhancedByName: "Ada",
        enhanceSkipped: 2,
        pendingMarks: [{ id: "b1", mark: "enhance-added", type: "paragraph", text: "x" }],
      }),
    );
    expect(html).toContain("2 blocks changed while this ran and were left as typed.");
  });

  it("enhanced: enhanced-by status, Enhance again primary, Discard secondary", () => {
    const html = render(makeRec({ phase: "done", enhancedAt: "2026-10-10T18:14:00Z", enhancedByName: "Ada", hasTranscript: true }));
    expect(html).toContain("Enhanced");
    expect(html).toContain("by Ada");
    // The explanation lives on the button's tooltip, not in the status line.
    expect(html).not.toContain("rebuilds the notes");
    expect(html).toContain("Enhance again");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("enhanced: appends 'Reviewed.' once reviewedAt is set", () => {
    const html = render(
      makeRec({
        phase: "done",
        enhancedAt: "2026-10-10T18:14:00Z",
        enhancedByName: "Ada",
        reviewedAt: "2026-10-10T18:15:00Z",
        hasTranscript: true,
      }),
    );
    expect(html).toContain("Reviewed.");
  });

  it("enhanced: no 'Reviewed.' when reviewedAt is unset", () => {
    const html = render(
      makeRec({ phase: "done", enhancedAt: "2026-10-10T18:14:00Z", enhancedByName: "Ada", hasTranscript: true }),
    );
    expect(html).not.toContain("Reviewed.");
  });

  it("enhanced: appends a names-changed notice once a speaker is renamed after Enhance ran", () => {
    const html = render(
      makeRec({
        phase: "done",
        enhancedAt: "2026-10-10T18:14:00Z",
        enhancedByName: "Ada",
        speakersChangedAt: "2026-10-10T18:20:00Z",
        hasTranscript: true,
      }),
    );
    expect(html).toContain("Names changed since these notes were written. Enhance again to update them.");
  });

  it("enhanced: no names-changed notice when the rename happened before Enhance ran", () => {
    const html = render(
      makeRec({
        phase: "done",
        enhancedAt: "2026-10-10T18:14:00Z",
        enhancedByName: "Ada",
        speakersChangedAt: "2026-10-10T18:00:00Z",
        hasTranscript: true,
      }),
    );
    expect(html).not.toContain("Names changed");
  });

  it("enhanced: no names-changed notice when no speaker was ever renamed", () => {
    const html = render(
      makeRec({ phase: "done", enhancedAt: "2026-10-10T18:14:00Z", enhancedByName: "Ada", hasTranscript: true }),
    );
    expect(html).not.toContain("Names changed");
  });

  it("inserted: transcript-inserted status, Enhance notes primary, Discard secondary", () => {
    const html = render(makeRec({ phase: "done", insertedAt: "2026-10-10T18:14:00Z", hasTranscript: true }));
    expect(html).toContain("Transcript inserted. Enhance can still write notes from it. Discarding only removes the recording, not what was inserted.");
    expect(html).toContain("Enhance notes");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("inserted with AI off: no Enhance button or mention", () => {
    const html = render(makeRec({ phase: "done", insertedAt: "2026-10-10T18:14:00Z", hasTranscript: true, aiEnabled: false }));
    expect(html).toContain("Transcript inserted. Discarding only removes the recording, not what was inserted.");
    expect(html).not.toContain("Enhance");
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

  it("recording (following): shows 'last audio N min ago' once lastChunkAt is a few minutes old", () => {
    const html = render(
      makeRec({
        phase: "recording",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        elapsed: 60,
        lastChunkAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      }),
    );
    expect(html).toContain("· last audio 4 min ago");
  });

  it("recording (following): shows 'last audio just now' under 60 seconds", () => {
    const html = render(
      makeRec({
        phase: "recording",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        elapsed: 60,
        lastChunkAt: new Date(Date.now() - 10_000).toISOString(),
      }),
    );
    expect(html).toContain("· last audio just now");
  });

  it("recording (following): shows 'no audio yet' when lastChunkAt is null", () => {
    const html = render(
      makeRec({
        phase: "recording",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        elapsed: 60,
        lastChunkAt: null,
      }),
    );
    expect(html).toContain("· no audio yet");
  });

  it("recording (following): the owner's own other-device view never shows a last-audio suffix", () => {
    const html = render(
      makeRec({
        phase: "recording",
        remote: { ownerName: "You", ownerIsYou: true },
        drives: true,
        elapsed: 60,
        lastChunkAt: null,
      }),
    );
    expect(html).toContain("· another device");
    expect(html).not.toContain("audio");
  });

  it("recording: a follower with canStopOthers sees a Stop button", () => {
    const html = render(
      makeRec({
        phase: "recording",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        canEdit: true,
        canStopOthers: true,
        canDiscard: false,
        isCore: false,
      }),
    );
    expect(html).toContain("Stop</button>");
  });

  it("recording: a follower without edit access sees no actions", () => {
    const html = render(
      makeRec({
        phase: "recording",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        canEdit: false,
        canStopOthers: false,
        canDiscard: false,
        isCore: false,
      }),
    );
    expect(html).not.toContain(">Stop<");
    expect(html).not.toContain("Discard recording");
  });

  it("recording: a Core follower sees Discard", () => {
    const html = render(
      makeRec({
        phase: "recording",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        canEdit: true,
        isCore: true,
        canStopOthers: true,
        canDiscard: true,
      }),
    );
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("stopping (stuck, following): an editor sees Transcribe anyway", () => {
    const html = render(
      makeRec({
        phase: "stopping",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        stopStuck: true,
        canStopOthers: true,
        canDiscard: false,
      }),
    );
    expect(html).toContain("Transcribe anyway");
    expect(html).not.toContain("Discard recording");
  });

  it("stopping (stuck, following): a Core editor sees Discard alongside Transcribe anyway", () => {
    const html = render(
      makeRec({
        phase: "stopping",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        stopStuck: true,
        canStopOthers: true,
        canDiscard: true,
      }),
    );
    expect(html).toContain("Transcribe anyway");
    expect(html).toContain('aria-label="Discard recording"');
  });

  it("stopping (stuck, following): a non-editor sees nothing", () => {
    const html = render(
      makeRec({
        phase: "stopping",
        remote: { ownerName: "Priya", ownerIsYou: false },
        drives: false,
        stopStuck: true,
        canStopOthers: false,
        canDiscard: false,
      }),
    );
    expect(html).not.toContain("Transcribe anyway");
    expect(html).not.toContain("Discard recording");
  });
});
