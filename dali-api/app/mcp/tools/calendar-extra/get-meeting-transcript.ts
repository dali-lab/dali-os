// MCP `get_meeting_transcript` — paged transcript lines for a meeting
// recording, with roster-resolved speaker labels (same resolution as the
// Done panel). Requires the `mcp:read` scope.
//
// NEVER log transcript text here.

import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { parseOccurrenceParam } from "~/lib/scheduled-meeting";
import { canReadRecording, storedLines } from "~/lib/meeting-recording.server";
import { speakerLabelFor, countSpeakersByChannel } from "~/components/meeting-recorder/transcript";
import type { Channel, RosterUser, Speakers } from "~/components/meeting-recorder/types";
import { McpNotFoundError, McpInvalidError } from "../../registry";

const LINES_PER_PAGE = 2000;

export const GET_MEETING_TRANSCRIPT_DEF = {
  name: "get_meeting_transcript",
  description:
    "Fetch the transcript of a finished meeting recording: lines with timestamps and resolved speaker labels (roster name once an editor has renamed a speaker, else You/Others or Speaker N). Paged at 2,000 lines per call; pass from/to to filter by seconds into the recording. Identify the recording by recordingId, or by meetingId (picks the newest Done recording for that occurrence, or the meeting's newest overall if occurrenceStart is omitted). Same audience as the note: the recording's owner, or anyone who can view the note it belongs to.",
  inputSchema: {
    type: "object" as const,
    properties: {
      recordingId: {
        type: "string",
        minLength: 1,
        description: "MeetingRecording.id. Alternative to meetingId.",
      },
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id. Alternative to recordingId.",
      },
      occurrenceStart: {
        type: "string",
        description:
          "With meetingId: which occurrence's recording to use (ISO 8601). Omitted picks the meeting's newest Done recording across all occurrences.",
      },
      from: {
        type: "number",
        minimum: 0,
        description: "Only return lines at or after this many seconds into the recording.",
      },
      to: {
        type: "number",
        minimum: 0,
        description: "Only return lines at or before this many seconds into the recording.",
      },
      cursor: {
        type: "integer",
        minimum: 0,
        description: "Opaque paging offset returned as nextCursor from a previous call. Omit for the first page.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  recordingId?: string;
  meetingId?: string;
  occurrenceStart?: string;
  from?: number;
  to?: number;
  cursor?: number;
};

const RECORDING_SELECT = {
  id: true,
  status: true,
  recordedSeconds: true,
  lines: true,
  speakers: true,
  userId: true,
  documentName: true,
  scheduledMeetingId: true,
  occurrenceStart: true,
} as const;

async function resolveRecording(input: Input) {
  if (input.recordingId) {
    return prisma.meetingRecording.findUnique({
      where: { id: input.recordingId },
      select: RECORDING_SELECT,
    });
  }
  if (input.meetingId) {
    const occurrenceStart = parseOccurrenceParam(input.occurrenceStart);
    return prisma.meetingRecording.findFirst({
      where: {
        scheduledMeetingId: input.meetingId,
        status: "Done",
        ...(occurrenceStart ? { occurrenceStart } : {}),
      },
      orderBy: occurrenceStart ? { createdAt: "desc" } : { occurrenceStart: "desc" },
      select: RECORDING_SELECT,
    });
  }
  throw new McpInvalidError("Pass either recordingId or meetingId.");
}

export async function runGetMeetingTranscript(callerId: string, input: Input) {
  const rec = await resolveRecording(input);
  if (!rec) throw new McpNotFoundError("Recording not found");

  const access = await canReadRecording(rec, callerId);
  if (!access) throw new McpNotFoundError("Recording not found");

  const roster: RosterUser[] =
    rec.scheduledMeetingId && rec.occurrenceStart
      ? (
          await prisma.meetingAttendance.findMany({
            where: { scheduledMeetingId: rec.scheduledMeetingId, occurrenceStart: rec.occurrenceStart },
            select: { userId: true, user: { select: { firstName: true, lastName: true, daliEmail: true } } },
          })
        ).map((a) => ({ userId: a.userId, name: fullName(a.user) || a.user.daliEmail || a.userId }))
      : [];

  const speakers = (rec.speakers as Speakers | null) ?? {};
  // All recordings are v2 (ai-meeting-notes was off before this feature), so
  // channel/end are always set in practice — normalized defensively in case
  // a row is ever missing one.
  const normalized = storedLines(rec).map((l) => ({
    ...l,
    channel: (l.channel ?? "mic") as Channel,
    end: l.end ?? l.at,
  }));
  const counts = countSpeakersByChannel(normalized);
  const keyFor = (l: (typeof normalized)[number]) => l.speaker ?? l.channel;

  const speakersOut: { key: string; label: string }[] = [];
  const seenKeys = new Set<string>();
  for (const l of normalized) {
    const key = keyFor(l);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    speakersOut.push({ key, label: speakerLabelFor(l, counts, speakers, roster) });
  }

  let filtered = [...normalized].sort((a, b) => a.at - b.at);
  if (input.from !== undefined) filtered = filtered.filter((l) => l.at >= input.from!);
  if (input.to !== undefined) filtered = filtered.filter((l) => l.at <= input.to!);

  const cursor = input.cursor ?? 0;
  const page = filtered.slice(cursor, cursor + LINES_PER_PAGE);
  const nextCursor = cursor + LINES_PER_PAGE < filtered.length ? cursor + LINES_PER_PAGE : null;

  return {
    recordingId: rec.id,
    status: rec.status,
    recordedSeconds: rec.recordedSeconds,
    speakers: speakersOut,
    lines: page.map((l) => ({ at: l.at, end: l.end, speaker: keyFor(l), text: l.text })),
    nextCursor,
  };
}
