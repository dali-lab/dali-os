// MCP `get_google_calendar_busy` — fetch the caller's Google Calendar busy
// blocks for a given time range. Self-only (always the caller's own tokens).
// Requires the `mcp:read` scope.

import { fetchBusyEvents, type EventReadReport } from "~/lib/google-calendar";
import { McpInvalidError } from "../../registry";

export const GET_GOOGLE_CALENDAR_BUSY_DEF = {
  name: "get_google_calendar_busy",
  description:
    "Fetch your own Google Calendar busy blocks for a time range. Returns an empty array if no Google calendar is linked. Every page of events is read, up to 2,500 events per calendar; truncated is true when a calendar had more events than that, so the busy list may be missing some.",
  inputSchema: {
    type: "object" as const,
    properties: {
      start: {
        type: "string",
        minLength: 1,
        description: "ISO 8601 start of the range (inclusive).",
      },
      end: {
        type: "string",
        minLength: 1,
        description: "ISO 8601 end of the range (exclusive).",
      },
    },
    required: ["start", "end"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { start: string; end: string };

export async function runGetGoogleCalendarBusy(userId: string, input: Input) {
  const start = new Date(input.start);
  const end = new Date(input.end);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new McpInvalidError("start and end must be valid ISO 8601 timestamps");
  }
  if (end <= start) {
    throw new McpInvalidError("end must be after start");
  }

  let busy;
  const report: EventReadReport = { truncated: false };
  try {
    busy = await fetchBusyEvents(userId, start, end, undefined, undefined, "availability", report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new McpInvalidError(`Google Calendar error: ${message}`);
  }

  return { busy, truncated: report.truncated };
}
