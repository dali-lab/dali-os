// Pure helpers for meeting-note recording (MeetingRecorder). Client-safe.

export type TranscriptLine = {
  /** Seconds since recording started. */
  at: number;
  text: string;
};

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// One "[mm:ss] text" line per recognized phrase. The leading timestamp also
// keeps a phrase that starts with "#" or "-" from parsing as Markdown.
export function transcriptText(lines: TranscriptLine[]): string {
  return lines
    .filter((l) => l.text.trim())
    .map((l) => `[${formatClock(l.at)}] ${l.text.trim()}`)
    .join("\n");
}

// What gets appended to the note: the AI write-up when there is one, then the
// full transcript underneath it.
export function meetingNotesMarkdown(notes: string | null, lines: TranscriptLine[]): string {
  const parts = ["## AI meeting notes"];
  if (notes?.trim()) parts.push(notes.trim());
  const transcript = transcriptText(lines);
  if (transcript) parts.push("### Transcript", transcript.split("\n").join("\n\n"));
  return parts.join("\n\n");
}
