// MCP room tools — see, book, and cancel DALI rooms. Mirrors the web room routes
// (any lab member; cancelling is the booker or Core) over the same conflict
// checks in ~/lib/rooms.server.

import { prisma } from "~/lib/db.server";
import { buildRule } from "~/lib/meeting-occurrences";
import { isLabMember } from "~/lib/roles";
import {
  cancelRoomBookingAsMember,
  createRoomBooking,
  getRoomSchedule,
  listBookableRooms,
  listRoomAvailability,
  parseWindowParams,
  serializeScheduleItem,
  type RoomWriteResult,
} from "~/rooms/lib/rooms.server";
import { McpError, McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../errors";

const OFFSET_ISO = /T.*(Z|[+-]\d{2}:?\d{2})$/i;

const INSTANT_HINT = "ISO 8601 with a UTC offset, e.g. 2026-11-03T14:00:00-05:00.";

// Without an offset, Date parses in the server's zone, which isn't the lab's.
function parseInstant(value: string, field: string): Date {
  const date = new Date(value);
  if (!OFFSET_ISO.test(value) || Number.isNaN(date.getTime())) {
    throw new McpInvalidError(`${field} must be ${INSTANT_HINT}`);
  }
  return date;
}

function parseScheduleWindow(start: string, end: string) {
  parseInstant(start, "start");
  parseInstant(end, "end");
  const window = parseWindowParams(start, end);
  if (!window) throw new McpInvalidError("end must be after start, at most 8 days later");
  return window;
}

async function requireLabMember(userId: string) {
  if (!(await isLabMember(userId))) throw new McpForbiddenError();
}

function unwrap<T>(result: RoomWriteResult<T>): T {
  if (!result.ok) throw new McpError(result.error, result.status);
  return result.value;
}

export const LIST_ROOMS_DEF = {
  name: "list_rooms",
  description:
    "List the DALI rooms that can be booked. Pass start and end to also get each room's conflict in that window (null when free); add recurrenceRule to check every occurrence of a repeating booking, where conflictOn names the first colliding date after the first occurrence.",
  inputSchema: {
    type: "object" as const,
    properties: {
      start: { type: "string", description: `Window start. ${INSTANT_HINT}` },
      end: { type: "string", description: "Window end, at most 8 days after start. Same format as start." },
      recurrenceRule: {
        type: "string",
        maxLength: 500,
        description: "RFC 5545 RRULE. Requires start and end, which then describe the first occurrence.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type ListInput = { start?: string; end?: string; recurrenceRule?: string };

export async function runListRooms(userId: string, input: ListInput) {
  await requireLabMember(userId);
  if (!input.start && !input.end && !input.recurrenceRule) return { rooms: await listBookableRooms() };
  if (!input.start || !input.end) throw new McpInvalidError("start and end must be passed together");

  const window = parseScheduleWindow(input.start, input.end);
  if (input.recurrenceRule && !buildRule(input.recurrenceRule, window.start)) {
    throw new McpInvalidError("That repeat rule isn't valid");
  }
  return { rooms: await listRoomAvailability(window, { recurrenceRule: input.recurrenceRule }) };
}

export const GET_ROOM_SCHEDULE_DEF = {
  name: "get_room_schedule",
  description:
    "Get a room's bookings and meetings in a window of up to 8 days. Items with kind 'booking' carry the id and occurrenceStart that cancel_room_booking takes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      roomId: { type: "string", minLength: 1, description: "Room id from list_rooms." },
      start: { type: "string", description: `Window start. ${INSTANT_HINT}` },
      end: { type: "string", description: "Window end, at most 8 days after start. Same format as start." },
    },
    required: ["roomId", "start", "end"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type ScheduleInput = { roomId: string; start: string; end: string };

export async function runGetRoomSchedule(userId: string, input: ScheduleInput) {
  await requireLabMember(userId);
  const window = parseScheduleWindow(input.start, input.end);
  const room = await prisma.room.findUnique({
    where: { id: input.roomId },
    select: { id: true, name: true, description: true, capacity: true, archivedAt: true },
  });
  if (!room || room.archivedAt) throw new McpNotFoundError("Room not found");

  const items = await getRoomSchedule(room.id, window.start, window.end);
  return {
    room: { id: room.id, name: room.name, description: room.description, capacity: room.capacity },
    items: items.map(serializeScheduleItem),
  };
}

export const BOOK_ROOM_DEF = {
  name: "book_room",
  description:
    "Book a DALI room for yourself. A booking lasts at most 8 hours and can start up to 90 days ahead. Fails if the room is taken at any occurrence. To put a room on a meeting, pass roomIds to schedule_meeting instead.",
  inputSchema: {
    type: "object" as const,
    properties: {
      roomId: { type: "string", minLength: 1, description: "Room id from list_rooms." },
      start: { type: "string", description: `Booking start. ${INSTANT_HINT}` },
      end: { type: "string", description: "Booking end. Same format as start." },
      title: { type: "string", maxLength: 200, description: "Shown on the room's schedule." },
      recurrenceRule: {
        type: "string",
        maxLength: 500,
        description: "RFC 5545 RRULE to repeat the booking. Needs COUNT or UNTIL and must end within the current term.",
      },
    },
    required: ["roomId", "start", "end"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type BookInput = { roomId: string; start: string; end: string; title?: string; recurrenceRule?: string };

export async function runBookRoom(userId: string, input: BookInput) {
  await requireLabMember(userId);
  const booking = unwrap(
    await createRoomBooking({
      roomId: input.roomId,
      userId,
      start: parseInstant(input.start, "start"),
      end: parseInstant(input.end, "end"),
      title: input.title,
      source: "App",
      recurrenceRule: input.recurrenceRule,
    }),
  );
  return {
    bookingId: booking.id,
    roomId: input.roomId,
    start: booking.start.toISOString(),
    end: booking.end.toISOString(),
  };
}

export const CANCEL_ROOM_BOOKING_DEF = {
  name: "cancel_room_booking",
  description:
    "Cancel a room booking. Only the booker or Core can. A booking already underway ends now, freeing the rest of the slot. On a repeating booking, scope defaults to 'all', which cancels the whole series; 'this' and 'following' need occurrenceStart. Bookings managed by hiring can't be cancelled here.",
  inputSchema: {
    type: "object" as const,
    properties: {
      bookingId: { type: "string", minLength: 1, description: "Booking id from book_room or get_room_schedule." },
      scope: { type: "string", enum: ["this", "following", "all"], description: "Which occurrences to cancel." },
      occurrenceStart: {
        type: "string",
        description: "The occurrence's occurrenceStart from get_room_schedule.",
      },
    },
    required: ["bookingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type CancelInput = {
  bookingId: string;
  scope?: "this" | "following" | "all";
  occurrenceStart?: string;
};

export async function runCancelRoomBooking(userId: string, input: CancelInput) {
  await requireLabMember(userId);
  unwrap(
    await cancelRoomBookingAsMember(input.bookingId, userId, {
      scope: input.scope,
      occurrenceStart: input.occurrenceStart ? parseInstant(input.occurrenceStart, "occurrenceStart") : undefined,
    }),
  );
  return { ok: true };
}
