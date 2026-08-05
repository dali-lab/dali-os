// MCP `get_google_calendar_busy` — fetch the caller's Google Calendar busy
// blocks for a given time range. Self-only (always the caller's own tokens).
// Requires the `mcp:read` scope.

import { fetchBusyEvents } from "~/lib/google-calendar";
import { McpInvalidError } from "../../registry";

export const GET_GOOGLE_CALENDAR_BUSY_DEF = {
  name: "get_google_calendar_busy",
  description:
    "Fetch your own Google Calendar busy blocks for a time range. Returns an empty array if no Google calendar is linked.",
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
  try {
    busy = await fetchBusyEvents(userId, start, end);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new McpInvalidError(`Google Calendar error: ${message}`);
  }

  return { busy };
}
