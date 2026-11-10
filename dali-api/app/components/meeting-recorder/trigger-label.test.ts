import { describe, it, expect } from "vitest";
import { recorderTriggerLabel } from "./trigger-label";
import { makeRec } from "./test-support";

const mark = { id: "b1", mark: "enhance-added" as const, type: "paragraph", text: "x" };

describe("recorderTriggerLabel", () => {
  it("stays Record while live", () => {
    expect(recorderTriggerLabel(makeRec({ phase: "recording" }), true, null)).toBe("Record");
  });

  it("idle: Record for editors, Transcript for viewers", () => {
    expect(recorderTriggerLabel(makeRec({ phase: "idle" }), false, null)).toBe("Record");
    expect(recorderTriggerLabel(makeRec({ phase: "idle", canEdit: false }), false, null)).toBe("Transcript");
  });

  it("processing shows the stage pill", () => {
    expect(recorderTriggerLabel(makeRec({ phase: "processing" }), false, "Labeling")).toBe("Labeling");
  });

  it("a pending review reads Transcript, not Review (N)", () => {
    const label = recorderTriggerLabel(makeRec({ phase: "done", hasTranscript: true, pendingMarks: [mark, mark], enhancedAt: "2026-10-18T00:00:00Z" }), false, null);
    expect(label).toBe("Transcript");
  });

  it("enhanced with nothing pending reads Enhanced", () => {
    expect(recorderTriggerLabel(makeRec({ phase: "done", hasTranscript: true, enhancedAt: "2026-10-18T00:00:00Z" }), false, null)).toBe("Enhanced");
  });

  it("no transcript yet reads Show recording", () => {
    expect(recorderTriggerLabel(makeRec({ phase: "done", hasTranscript: false }), false, null)).toBe("Show recording");
  });
});
