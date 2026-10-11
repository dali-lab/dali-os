import { describe, it, expect } from "vitest";
import {
  formatClock,
  meetingNotesMarkdown,
  transcriptParagraphs,
  transcriptText,
} from "~/lib/meeting-transcript";

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

  it("labels speakers and orders the two sources by time", () => {
    expect(
      transcriptText([
        { at: 9, text: "sounds good", source: "you" },
        { at: 4, text: "can you hear me", source: "others" },
      ]),
    ).toBe("[00:04] Others: can you hear me\n[00:09] You: sounds good");
  });
});

describe("meetingNotesMarkdown", () => {
  const lines = [
    { at: 1, text: "first" },
    { at: 2, text: "second" },
  ];

  it("puts the AI notes under the section heading", () => {
    expect(meetingNotesMarkdown("### Summary\nShort.")).toBe(
      "## AI meeting notes\n\n### Summary\nShort.",
    );
  });

  it("keeps just the heading when there are no notes", () => {
    expect(meetingNotesMarkdown(null)).toBe("## AI meeting notes");
  });

  it("splits the transcript into one paragraph per line", () => {
    expect(transcriptParagraphs(lines)).toEqual(["[00:01] first", "[00:02] second"]);
    expect(transcriptParagraphs([])).toEqual([]);
  });
});
