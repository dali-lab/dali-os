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

const DEDUPE_WINDOW_SECONDS = 1.5;
const MIN_JACCARD_TOKENS = 3;
const JACCARD_THRESHOLD = 0.8;

function normalizedTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Drops a mic line that is an echo of something said on the call channel —
 * the speakerphone/call audio picking up the mic's own speech a beat later
 * (or vice versa in timing). Only meaningful once both channels exist; a
 * single-channel recording is returned unchanged. A mic line is dropped when
 * a call line starting within ±1.5s matches it: Jaccard token overlap ≥ 0.8
 * when the mic line has at least 3 tokens, exact normalized-text equality
 * for anything shorter (too few tokens for Jaccard to mean much).
 */
export function dedupeCrossChannel(lines: TranscriptLine[]): TranscriptLine[] {
  const micLines = lines.filter((l) => l.channel === "mic");
  const callLines = lines.filter((l) => l.channel === "call");
  if (micLines.length === 0 || callLines.length === 0) return lines;

  const toDrop = new Set<TranscriptLine>();
  for (const mic of micLines) {
    const micTokens = normalizedTokens(mic.text);
    for (const call of callLines) {
      if (Math.abs(mic.at - call.at) > DEDUPE_WINDOW_SECONDS) continue;
      const callTokens = normalizedTokens(call.text);
      const isEcho =
        micTokens.length >= MIN_JACCARD_TOKENS
          ? jaccard(micTokens, callTokens) >= JACCARD_THRESHOLD
          : micTokens.length > 0 && micTokens.join(" ") === callTokens.join(" ");
      if (isEcho) {
        toDrop.add(mic);
        break;
      }
    }
  }
  return toDrop.size === 0 ? lines : lines.filter((l) => !toDrop.has(l));
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
