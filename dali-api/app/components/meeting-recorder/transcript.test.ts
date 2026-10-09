import { describe, expect, it } from "vitest";
import {
  countSpeakersByChannel,
  formatClock,
  meetingNotesMarkdown,
  speakerLabelFor,
  transcriptParagraphs,
} from "./transcript";
import type { RosterUser, Speakers, TranscriptLine } from "./types";

describe("formatClock", () => {
  it("formats under an hour as mm:ss", () => {
    expect(formatClock(65)).toBe("01:05");
  });
  it("formats an hour or more as h:mm:ss", () => {
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("countSpeakersByChannel", () => {
  it("counts distinct speaker keys per channel", () => {
    const lines: TranscriptLine[] = [
      { at: 0, end: 1, text: "a", channel: "mic", speaker: "mic:1" },
      { at: 1, end: 2, text: "b", channel: "mic", speaker: "mic:2" },
      { at: 2, end: 3, text: "c", channel: "call", speaker: "call:1" },
      { at: 3, end: 4, text: "d", channel: "call" },
    ];
    expect(countSpeakersByChannel(lines)).toEqual({ mic: 2, call: 1 });
  });
});

describe("speakerLabelFor", () => {
  const roster: RosterUser[] = [{ userId: "u1", name: "Alex Kim" }];

  it("labels an unspeakered line by channel", () => {
    expect(speakerLabelFor({ channel: "mic" }, { mic: 0, call: 0 }, {}, roster)).toBe("You");
    expect(speakerLabelFor({ channel: "call" }, { mic: 0, call: 0 }, {}, roster)).toBe("Others");
  });

  it("stays the channel label when a channel has only one diarized speaker", () => {
    expect(speakerLabelFor({ channel: "mic", speaker: "mic:1" }, { mic: 1, call: 0 }, {}, roster)).toBe("You");
  });

  it("falls back to 'Speaker N' once a channel has more than one", () => {
    expect(speakerLabelFor({ channel: "mic", speaker: "mic:2" }, { mic: 2, call: 0 }, {}, roster)).toBe(
      "Speaker 2",
    );
  });

  it("resolves an assigned roster userId to their name", () => {
    const speakers: Speakers = { "mic:2": "u1" };
    expect(speakerLabelFor({ channel: "mic", speaker: "mic:2" }, { mic: 2, call: 0 }, speakers, roster)).toBe(
      "Alex Kim",
    );
  });

  it("shows assigned free text as-is when it isn't a roster userId", () => {
    const speakers: Speakers = { "mic:2": "Guest speaker" };
    expect(speakerLabelFor({ channel: "mic", speaker: "mic:2" }, { mic: 2, call: 0 }, speakers, roster)).toBe(
      "Guest speaker",
    );
  });
});

describe("transcriptParagraphs", () => {
  it("sorts by time and formats each line", () => {
    const lines: TranscriptLine[] = [
      { at: 5, end: 6, text: "second", channel: "mic" },
      { at: 0, end: 1, text: "first", channel: "call" },
    ];
    expect(transcriptParagraphs(lines, {}, [])).toEqual([
      "[00:00] Others: first",
      "[00:05] You: second",
    ]);
  });

  it("drops blank lines", () => {
    const lines: TranscriptLine[] = [{ at: 0, end: 1, text: "   ", channel: "mic" }];
    expect(transcriptParagraphs(lines, {}, [])).toEqual([]);
  });
});

describe("meetingNotesMarkdown", () => {
  it("includes the heading alone when there are no notes", () => {
    expect(meetingNotesMarkdown(null)).toBe("## AI meeting notes");
  });
  it("appends trimmed notes under the heading", () => {
    expect(meetingNotesMarkdown("  Summary here.  ")).toBe("## AI meeting notes\n\nSummary here.");
  });
});
