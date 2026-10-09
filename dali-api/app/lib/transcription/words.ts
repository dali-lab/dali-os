// Pure, client-safe helpers turning Parakeet words + pyannote diarization
// segments into the lines a MeetingRecording stores. See
// specs/meeting-transcription.md "dali-api" and "Data model".

import type { TranscriptLine } from "~/lib/meeting-transcript";

export type Word = { s: number; e: number; w: string; sp?: number };
export type DiarizationSegment = { s: number; e: number; speaker: number };

// A line before it's attributed to a channel — mergeChannels adds that and
// turns the bare numeric `speaker` into a "mic:1"-style key.
export type RawLine = { at: number; end: number; text: string; speaker?: number };

const PAUSE_SECONDS = 0.8;
const SENTENCE_END = /[.!?]["')\]]?$/;

/** Tags each word with the diarized speaker whose segment covers its
 *  midpoint, or the nearest segment when the midpoint falls in a gap. */
export function assignSpeakers(words: Word[], segments: DiarizationSegment[]): Word[] {
  if (segments.length === 0) return words.map((w) => ({ ...w }));

  return words.map((w) => {
    const mid = (w.s + w.e) / 2;
    let covering: DiarizationSegment | null = null;
    let nearest: DiarizationSegment | null = null;
    let nearestDist = Infinity;
    for (const seg of segments) {
      if (mid >= seg.s && mid < seg.e) {
        covering = seg;
        break;
      }
      const dist = mid < seg.s ? seg.s - mid : mid - seg.e;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = seg;
      }
    }
    const chosen = covering ?? nearest;
    return chosen ? { ...w, sp: chosen.speaker } : { ...w };
  });
}

/**
 * Group words into lines, breaking on a pause over 0.8s, sentence-ending
 * punctuation, or a speaker change. When `segments` is given, speakers are
 * (re)assigned first; otherwise each word's own `sp` (already assigned) is
 * used, so a caller that already ran assignSpeakers can skip redoing it.
 */
export function wordsToLines(words: Word[], segments: DiarizationSegment[] = []): RawLine[] {
  if (words.length === 0) return [];
  const source = segments.length > 0 ? assignSpeakers(words, segments) : words;
  const sorted = [...source].sort((a, b) => a.s - b.s);

  const lines: RawLine[] = [];
  let cur: { at: number; end: number; text: string[]; speaker?: number } | null = null;

  const flush = () => {
    if (!cur) return;
    lines.push({
      at: cur.at,
      end: cur.end,
      text: cur.text.join(" "),
      ...(cur.speaker !== undefined ? { speaker: cur.speaker } : {}),
    });
    cur = null;
  };

  for (const word of sorted) {
    if (cur) {
      const gap = word.s - cur.end;
      const speakerChanged = cur.speaker !== word.sp;
      const prevEndedSentence = SENTENCE_END.test(cur.text[cur.text.length - 1] ?? "");
      if (gap > PAUSE_SECONDS || speakerChanged || prevEndedSentence) flush();
    }
    if (!cur) cur = { at: word.s, end: word.e, text: [], speaker: word.sp };
    cur.text.push(word.w);
    cur.end = word.e;
  }
  flush();

  return lines;
}

/** Interleaves each channel's lines by start time into one transcript,
 *  stamping `channel` and turning the bare speaker index into "mic:1" etc. */
export function mergeChannels(linesByChannel: Record<string, RawLine[]>): TranscriptLine[] {
  const merged: TranscriptLine[] = [];
  for (const [channel, lines] of Object.entries(linesByChannel)) {
    for (const line of lines) {
      merged.push({
        at: line.at,
        end: line.end,
        text: line.text,
        ...(channel === "mic" || channel === "call" ? { channel } : {}),
        ...(line.speaker !== undefined ? { speaker: `${channel}:${line.speaker}` } : {}),
      });
    }
  }
  return merged.sort((a, b) => a.at - b.at);
}
