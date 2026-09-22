import { describe, it, expect } from "vitest";
import { formatClock, meetingNotesMarkdown, transcriptText } from "~/lib/meeting-transcript";

describe("formatClock", () => {
  it("shows minutes and seconds, and hours once past one", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(75.9)).toBe("01:15");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("transcriptText", () => {
  it("timestamps each phrase and skips blank ones", () => {
    expect(
      transcriptText([
        { at: 3, text: " hello everyone " },
        { at: 5, text: "   " },
        { at: 64, text: "# not a heading" },
      ]),
    ).toBe("[00:03] hello everyone\n[01:04] # not a heading");
  });
});

describe("meetingNotesMarkdown", () => {
  const lines = [
    { at: 1, text: "first" },
    { at: 2, text: "second" },
  ];

  it("puts the AI notes above the transcript", () => {
    expect(meetingNotesMarkdown("### Summary\nShort.", lines)).toBe(
      "## AI meeting notes\n\n### Summary\nShort.\n\n### Transcript\n\n[00:01] first\n\n[00:02] second",
    );
  });

  it("keeps just the transcript when there are no notes", () => {
    expect(meetingNotesMarkdown(null, lines)).toBe(
      "## AI meeting notes\n\n### Transcript\n\n[00:01] first\n\n[00:02] second",
    );
  });
});
