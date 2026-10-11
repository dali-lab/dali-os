// Pure helpers for meeting-note recording (MeetingRecorder). Client-safe.

export type TranscriptLine = {
  /** Seconds since recording started. */
  at: number;
  /** Seconds since recording started, line end. Absent on pre-v2 rows. */
  end?: number;
  text: string;
  /** Legacy (pre-v2 desktop recordings, on-device recognizer): "you" is the
   *  recorder's microphone, "others" is the Mac's system audio. */
  source?: "you" | "others";
  /** v2: which capture channel this line came from. */
  channel?: "mic" | "call";
  /** v2: "mic:1", "call:2", … — or a renamed display string once an editor
   *  picks a roster name or types free text. */
  speaker?: string;
};

export const SOURCE_LABEL = { you: "You", others: "Others" } as const;

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// One "[mm:ss] Speaker: text" line per recognized phrase, in time order (the
// two audio sources are transcribed separately and can arrive interleaved).
// The leading timestamp also keeps a phrase that starts with "#" or "-" from
// parsing as Markdown.
export function transcriptText(lines: TranscriptLine[]): string {
  return [...lines]
    .filter((l) => l.text.trim())
    .sort((a, b) => a.at - b.at)
    .map((l) => {
      const who = l.source ? `${SOURCE_LABEL[l.source]}: ` : "";
      return `[${formatClock(l.at)}] ${who}${l.text.trim()}`;
    })
    .join("\n");
}

// The Markdown half of what gets appended to the note: the heading and the AI
// write-up when there is one. The transcript is appended separately as blocks
// (see transcriptParagraphs) so it can sit under a collapsed toggle heading,
// which Markdown can't express.
export function meetingNotesMarkdown(notes: string | null): string {
  const parts = ["## AI meeting notes"];
  if (notes?.trim()) parts.push(notes.trim());
  return parts.join("\n\n");
}

// One paragraph per transcript line, in time order.
export function transcriptParagraphs(lines: TranscriptLine[]): string[] {
  const text = transcriptText(lines);
  return text ? text.split("\n") : [];
}
