// MCP `find_mutual_freebusy` — free-time intersection across multiple users.
// Wraps the shared `findMutualFreeSlots` helper that powers the in-app group
// availability scheduler. The caller's userId is implicitly added to the
// participant list. Requires the `mcp:read` scope.

import { findMutualFreeSlots } from "~/lib/availability";

export const FIND_MUTUAL_FREEBUSY_TOOL = {
  name: "find_mutual_freebusy",
  description:
    "Find time slots where all listed participants are mutually free. The authenticated caller is implicitly included.",
  inputSchema: {
    type: "object" as const,
    properties: {
      participantUserIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        maxItems: 8,
        description:
          "User IDs of other participants. Caller is added if not already present. Max 8 total.",
      },
      windowStart: {
        type: "string",
        description: "ISO 8601 window start (e.g. 2026-05-14T13:00:00Z).",
      },
      windowEnd: {
        type: "string",
        description: "ISO 8601 window end. Span must be ≤ 7 days.",
      },
      slotMinutes: {
        type: "integer",
        enum: [15, 30, 45, 60],
        description: "Minimum slot length in minutes (default 30).",
      },
    },
    required: ["participantUserIds", "windowStart", "windowEnd"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  participantUserIds: string[];
  windowStart: string;
  windowEnd: string;
  slotMinutes?: number;
};

const MAX_PARTICIPANTS = 8;
const MAX_SPAN_MS = 7 * 24 * 60 * 60 * 1000;

export async function runFindMutualFreebusy(callerId: string, input: Input) {
  const windowStart = new Date(input.windowStart);
  const windowEnd = new Date(input.windowEnd);
  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    throw new Error("windowStart/windowEnd must be ISO 8601 timestamps");
  }
  if (windowEnd <= windowStart) {
    throw new Error("windowEnd must be after windowStart");
  }
  if (windowEnd.getTime() - windowStart.getTime() > MAX_SPAN_MS) {
    throw new Error("Window span must be ≤ 7 days");
  }

  const slotMinutes = input.slotMinutes ?? 30;
  if (![15, 30, 45, 60].includes(slotMinutes)) {
    throw new Error("slotMinutes must be one of 15, 30, 45, 60");
  }

  const participants = Array.from(
    new Set([callerId, ...input.participantUserIds]),
  );
  if (participants.length > MAX_PARTICIPANTS) {
    throw new Error(`Max ${MAX_PARTICIPANTS} participants (including caller)`);
  }

  const slots = await findMutualFreeSlots(
    participants,
    windowStart,
    windowEnd,
    slotMinutes,
  );

  return {
    slots: slots.map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
    })),
  };
}
