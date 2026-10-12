// Pure "is this occurrence live right now" check for the in-page record
// banner — spec: "5 minutes before start until end". Callers resolve the two
// timestamps themselves (documents.$pageId has only occurrenceStart +
// durationMinutes with no exception handling; calendar.meeting.$id already
// resolves an occurrence's actual start/end via resolveOccurrence), so this
// stays a plain interval check with no knowledge of exceptions.

export const RECORD_PROMPT_LEAD_MS = 5 * 60_000;

export function isRecordPromptWindow(nowMs: number, windowStartMs: number, windowEndMs: number): boolean {
  return nowMs >= windowStartMs - RECORD_PROMPT_LEAD_MS && nowMs <= windowEndMs;
}
