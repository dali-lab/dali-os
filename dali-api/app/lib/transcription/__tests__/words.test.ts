import { describe, it, expect } from "vitest";
import { assignSpeakers, dedupeCrossChannel, mergeChannels, wordsToLines } from "~/lib/transcription/words";
import type { TranscriptLine } from "~/lib/meeting-transcript";

describe("assignSpeakers", () => {
  it("tags each word with the segment covering its midpoint", () => {
    const words = [
      { s: 0, e: 1, w: "hi" }, // mid 0.5 -> speaker 1
      { s: 5, e: 6, w: "there" }, // mid 5.5 -> speaker 2
    ];
    const segments = [
      { s: 0, e: 2, speaker: 1 },
      { s: 4, e: 8, speaker: 2 },
    ];
    expect(assignSpeakers(words, segments)).toEqual([
      { s: 0, e: 1, w: "hi", sp: 1 },
      { s: 5, e: 6, w: "there", sp: 2 },
    ]);
  });

  it("falls back to the nearest segment when a word's midpoint falls in a gap", () => {
    const words = [{ s: 1.9, e: 2.1, w: "um" }]; // mid 2.0, between segments
    const segments = [
      { s: 0, e: 2, speaker: 1 },
      { s: 2.5, e: 4, speaker: 2 },
    ];
    expect(assignSpeakers(words, segments)[0]!.sp).toBe(1);
  });

  it("leaves words untagged when there are no segments", () => {
    expect(assignSpeakers([{ s: 0, e: 1, w: "hi" }], [])).toEqual([{ s: 0, e: 1, w: "hi" }]);
  });
});

describe("wordsToLines", () => {
  it("joins consecutive words into one line", () => {
    const words = [
      { s: 0, e: 0.3, w: "hi" },
      { s: 0.4, e: 0.7, w: "there" },
    ];
    expect(wordsToLines(words)).toEqual([{ at: 0, end: 0.7, text: "hi there" }]);
  });

  it("breaks on a pause over 0.8s", () => {
    const words = [
      { s: 0, e: 0.3, w: "hi" },
      { s: 1.5, e: 1.8, w: "there" }, // gap 1.2s
    ];
    expect(wordsToLines(words)).toEqual([
      { at: 0, end: 0.3, text: "hi" },
      { at: 1.5, end: 1.8, text: "there" },
    ]);
  });

  it("breaks on sentence-ending punctuation even with no pause", () => {
    const words = [
      { s: 0, e: 0.3, w: "Done." },
      { s: 0.35, e: 0.6, w: "Next" },
    ];
    expect(wordsToLines(words)).toEqual([
      { at: 0, end: 0.3, text: "Done." },
      { at: 0.35, end: 0.6, text: "Next" },
    ]);
  });

  it("breaks on a speaker change, via an already-assigned sp", () => {
    const words = [
      { s: 0, e: 0.3, w: "hi", sp: 1 },
      { s: 0.35, e: 0.6, w: "yo", sp: 2 },
    ];
    expect(wordsToLines(words)).toEqual([
      { at: 0, end: 0.3, text: "hi", speaker: 1 },
      { at: 0.35, end: 0.6, text: "yo", speaker: 2 },
    ]);
  });

  it("assigns speakers from segments when given, rather than trusting word.sp", () => {
    const words = [{ s: 0, e: 0.3, w: "hi" }];
    const segments = [{ s: 0, e: 1, speaker: 7 }];
    expect(wordsToLines(words, segments)).toEqual([{ at: 0, end: 0.3, text: "hi", speaker: 7 }]);
  });

  it("returns nothing for no words", () => {
    expect(wordsToLines([])).toEqual([]);
  });
});

describe("mergeChannels", () => {
  it("interleaves channels by start time and stamps channel-qualified speaker keys", () => {
    const merged = mergeChannels({
      mic: [{ at: 0, end: 1, text: "hi", speaker: 1 }],
      call: [{ at: 0.5, end: 1.5, text: "hey" }],
    });
    expect(merged).toEqual([
      { at: 0, end: 1, text: "hi", channel: "mic", speaker: "mic:1" },
      { at: 0.5, end: 1.5, text: "hey", channel: "call" },
    ]);
  });

  it("returns nothing for no channels", () => {
    expect(mergeChannels({})).toEqual([]);
  });
});

describe("dedupeCrossChannel", () => {
  it("drops a mic line echoed on the call channel within the window", () => {
    const lines: TranscriptLine[] = [
      { at: 10, end: 12, text: "we should ship this friday", channel: "mic" },
      { at: 10.8, end: 12.9, text: "we should ship this friday", channel: "call" },
    ];
    expect(dedupeCrossChannel(lines)).toEqual([lines[1]]);
  });

  it("keeps both lines when the text doesn't overlap", () => {
    const lines: TranscriptLine[] = [
      { at: 10, end: 11, text: "let's grab lunch", channel: "mic" },
      { at: 10.3, end: 12, text: "the weather is nice today", channel: "call" },
    ];
    expect(dedupeCrossChannel(lines)).toEqual(lines);
  });

  it("keeps a matching mic line outside the 1.5s window", () => {
    const lines: TranscriptLine[] = [
      { at: 10, end: 12, text: "we should ship this friday", channel: "mic" },
      { at: 12.5, end: 14, text: "we should ship this friday", channel: "call" },
    ];
    expect(dedupeCrossChannel(lines)).toEqual(lines);
  });

  it("leaves a single-channel transcript untouched", () => {
    const lines: TranscriptLine[] = [
      { at: 0, end: 1, text: "hi there", channel: "mic" },
      { at: 2, end: 3, text: "how's it going", channel: "mic" },
    ];
    expect(dedupeCrossChannel(lines)).toEqual(lines);
  });

  it("uses exact normalized equality for short (under 3 token) lines", () => {
    const lines: TranscriptLine[] = [
      { at: 10, end: 10.4, text: "Yeah", channel: "mic" },
      { at: 10.2, end: 10.6, text: "Yeah", channel: "call" },
      { at: 20, end: 20.4, text: "Yeah", channel: "mic" },
      { at: 20.2, end: 20.6, text: "Yep", channel: "call" },
    ];
    expect(dedupeCrossChannel(lines)).toEqual([lines[1], lines[2], lines[3]]);
  });
});
