// Pure display/formatting helpers for transcript lines. Lines are always
// server-built from words (see the server's words.ts); this module only
// turns them into what the Done panel and "Insert transcript" render.

import type { Channel, RosterUser, Speakers, SpeakerKey, TranscriptLine } from "./types";

export const CHANNEL_LABEL: Record<Channel, string> = { mic: "You", call: "Others" };

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** How many distinct diarized speakers each channel's lines carry. */
export function countSpeakersByChannel(lines: TranscriptLine[]): Record<Channel, number> {
  const mic = new Set<SpeakerKey>();
  const call = new Set<SpeakerKey>();
  for (const line of lines) {
    if (!line.speaker) continue;
    (line.channel === "mic" ? mic : call).add(line.speaker);
  }
  return { mic: mic.size, call: call.size };
}

/**
 * A line's display label: the roster/free-text name once a speaker is
 * renamed, else "Speaker N" once a channel has more than one diarized
 * speaker, else the plain channel label (You / Others) — the common case of
 * one person per channel never shows a speaker number at all.
 */
export function speakerLabelFor(
  line: { channel: Channel; speaker?: SpeakerKey },
  speakerCountByChannel: Record<Channel, number>,
  speakers: Speakers,
  roster: RosterUser[],
): string {
  if (line.speaker) {
    const assigned = speakers[line.speaker];
    if (assigned) {
      const match = roster.find((r) => r.userId === assigned);
      return match ? match.name : assigned;
    }
  }
  if (!line.speaker) return CHANNEL_LABEL[line.channel];
  const count = speakerCountByChannel[line.channel] ?? 1;
  if (count <= 1) return CHANNEL_LABEL[line.channel];
  const n = line.speaker.split(":")[1] ?? "1";
  return `Speaker ${n}`;
}

/** One "[mm:ss] Label: text" paragraph per line, in time order. */
export function transcriptParagraphs(lines: TranscriptLine[], speakers: Speakers, roster: RosterUser[]): string[] {
  const counts = countSpeakersByChannel(lines);
  return [...lines]
    .filter((l) => l.text.trim())
    .sort((a, b) => a.at - b.at)
    .map((l) => `[${formatClock(l.at)}] ${speakerLabelFor(l, counts, speakers, roster)}: ${l.text.trim()}`);
}

export function meetingNotesMarkdown(notes: string | null): string {
  const parts = ["## AI meeting notes"];
  if (notes?.trim()) parts.push(notes.trim());
  return parts.join("\n\n");
}
