// MCP `optimize_group_meetings` — plan a batch of meetings, one per group, over
// a window so that TOTAL attendance across all of them is maximized.
//
// Why this exists: `find_mutual_freebusy` / `get_group_availability` return raw
// overlap for a single set of people. When you want a meeting with EACH project
// group plus staff in the same week, people who sit on more than one group can't
// be in two meetings at once — picking each group's best slot independently
// double-books them. This tool jointly assigns all the slots (see
// ~/lib/meeting-optimizer) and reports who attends, who's double-booked, and who
// simply isn't free. It is read-only: it recommends slots; create them with
// `schedule_meeting`.

import { computeUserFreeBusy, type Interval } from "~/lib/availability";
import { resolveGroupMembers } from "~/lib/groups";
import {
  optimizeMeetingSchedule,
  type OptimizerMeeting,
} from "~/lib/meeting-optimizer";
import { prisma } from "~/lib/db";
import {
  formatDateTimeInZone,
  getZonedYMD,
  isValidTimezone,
  zonedWallTimeUtc,
} from "~/lib/timezone";
// Import from the leaf ./errors, not ../../registry: this file is imported by
// the calendar module the registry aggregates, so importing the registry here
// forms an initialization cycle (undefined tool defs) when this module loads
// first — e.g. imported directly by its own test.
import { McpInvalidError } from "../../errors";

export const OPTIMIZE_GROUP_MEETINGS_DEF = {
  name: "optimize_group_meetings",
  description:
    "Plan multiple meetings — one per group — over a time window so total attendance is maximized across all of them. Unlike find_mutual_freebusy (single-group overlap), this jointly places every meeting so people who belong to more than one group aren't double-booked, and reports the recommended slot, attendees, double-bookings, and who has no linked calendar. Read-only: create the chosen meetings with schedule_meeting.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetings: {
        type: "array",
        minItems: 1,
        maxItems: 15,
        description:
          "One entry per meeting to schedule. Give each a groupId, an explicit memberUserIds list, or both.",
        items: {
          type: "object",
          properties: {
            key: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              description:
                "Stable identifier for this meeting, echoed in the result and used to name double-booking conflicts. Auto-assigned (m1, m2, …) if omitted.",
            },
            label: {
              type: "string",
              maxLength: 200,
              description: "Human label. Defaults to the group name or the key.",
            },
            groupId: {
              type: "string",
              minLength: 1,
              description: "Existing group; members are resolved automatically.",
            },
            memberUserIds: {
              type: "array",
              items: { type: "string", minLength: 1 },
              description: "Ad-hoc member userIds. Merged with groupId members if both are given.",
            },
            requiredUserIds: {
              type: "array",
              items: { type: "string", minLength: 1 },
              description:
                "Members who MUST be able to attend — slots where any of them is busy are discarded. Added to the member set if not already present.",
            },
            durationMinutes: {
              type: "integer",
              minimum: 5,
              maximum: 480,
              description: "Overrides the top-level durationMinutes for this meeting.",
            },
          },
          additionalProperties: false,
        },
      },
      windowStart: {
        type: "string",
        minLength: 1,
        description: "ISO 8601 start of the scheduling window (inclusive).",
      },
      windowEnd: {
        type: "string",
        minLength: 1,
        description: "ISO 8601 end of the scheduling window (exclusive). Span must be ≤ 14 days.",
      },
      durationMinutes: {
        type: "integer",
        minimum: 5,
        maximum: 480,
        description: "Default meeting length in minutes (per-meeting durationMinutes overrides it).",
      },
      slotMinutes: {
        type: "integer",
        enum: [15, 30, 60],
        description: "Granularity of candidate start times (default 30).",
      },
      timezone: {
        type: "string",
        minLength: 1,
        description: "IANA timezone the working-hours band and slot times are expressed in (e.g. America/New_York).",
      },
      dayStartHour: {
        type: "integer",
        minimum: 0,
        maximum: 23,
        description: "Earliest local hour a meeting may start (default 9).",
      },
      dayEndHour: {
        type: "integer",
        minimum: 1,
        maximum: 24,
        description: "Latest local hour a meeting may end (default 18).",
      },
      includeWeekends: {
        type: "boolean",
        description: "Allow Saturday/Sunday slots (default false).",
      },
      alternativesPerMeeting: {
        type: "integer",
        minimum: 0,
        maximum: 5,
        description: "How many runner-up slots to return per meeting (default 3).",
      },
    },
    required: ["meetings", "windowStart", "windowEnd", "durationMinutes", "timezone"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type MeetingInput = {
  key?: string;
  label?: string;
  groupId?: string;
  memberUserIds?: string[];
  requiredUserIds?: string[];
  durationMinutes?: number;
};

type Input = {
  meetings: MeetingInput[];
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  slotMinutes?: number;
  timezone: string;
  dayStartHour?: number;
  dayEndHour?: number;
  includeWeekends?: boolean;
  alternativesPerMeeting?: number;
};

const MAX_SPAN_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_TOTAL_USERS = 200;
const MAX_CANDIDATE_STARTS = 400;

/** A member is free for [startMs, endMs] iff one free interval covers the whole
 *  slot. Free lists are sorted by start, so we can stop once we pass the slot. */
function isFreeDuring(free: Interval[], startMs: number, endMs: number): boolean {
  for (const iv of free) {
    if (iv.start.getTime() >= endMs) break;
    if (iv.start.getTime() <= startMs && iv.end.getTime() >= endMs) return true;
  }
  return false;
}

/** Business-hours grid of candidate start instants across the window. */
function candidateStarts(
  windowStart: Date,
  windowEnd: Date,
  timezone: string,
  dayStartHour: number,
  dayEndHour: number,
  slotMinutes: number,
  includeWeekends: boolean,
): { startMs: number; localMinute: number }[] {
  const out: { startMs: number; localMinute: number }[] = [];
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const first = getZonedYMD(windowStart, timezone);
  const last = getZonedYMD(windowEnd, timezone);

  // Walk calendar dates in the window's zone via UTC-anchored midnights.
  let cursor = new Date(Date.UTC(first.year, first.month - 1, first.day));
  const lastUtc = new Date(Date.UTC(last.year, last.month - 1, last.day));
  const bandStart = dayStartHour * 60;
  const bandEnd = dayEndHour * 60;

  while (cursor.getTime() <= lastUtc.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    if (includeWeekends || !isWeekend) {
      for (let localMinute = bandStart; localMinute < bandEnd; localMinute += slotMinutes) {
        const instant = zonedWallTimeUtc(y, m, d, Math.floor(localMinute / 60), localMinute % 60, timezone);
        const t = instant.getTime();
        if (t >= startMs && t < endMs) out.push({ startMs: t, localMinute });
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60_000);
  }
  return out;
}

export async function runOptimizeGroupMeetings(input: Input) {
  const windowStart = new Date(input.windowStart);
  const windowEnd = new Date(input.windowEnd);
  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    throw new McpInvalidError("windowStart and windowEnd must be valid ISO 8601 dates");
  }
  if (windowEnd <= windowStart) {
    throw new McpInvalidError("windowEnd must be after windowStart");
  }
  if (windowEnd.getTime() - windowStart.getTime() > MAX_SPAN_MS) {
    throw new McpInvalidError("Window span must be ≤ 14 days");
  }
  if (!isValidTimezone(input.timezone)) {
    throw new McpInvalidError("timezone must be a valid IANA timezone");
  }

  const slotMinutes = input.slotMinutes ?? 30;
  if (![15, 30, 60].includes(slotMinutes)) {
    throw new McpInvalidError("slotMinutes must be one of 15, 30, 60");
  }
  const dayStartHour = input.dayStartHour ?? 9;
  const dayEndHour = input.dayEndHour ?? 18;
  if (dayEndHour <= dayStartHour) {
    throw new McpInvalidError("dayEndHour must be greater than dayStartHour");
  }
  const includeWeekends = input.includeWeekends ?? false;
  const alternativesPerMeeting = input.alternativesPerMeeting ?? 3;

  // ── Resolve each meeting's member + required sets ──────────────────────────
  const groupIds = Array.from(
    new Set(input.meetings.map((m) => m.groupId).filter((g): g is string => !!g)),
  );
  const groupNames = new Map<string, string>();
  if (groupIds.length > 0) {
    const rows = await prisma.groupDefinition.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) groupNames.set(r.id, r.name);
  }

  const seenKeys = new Set<string>();
  const resolved = await Promise.all(
    input.meetings.map(async (m, idx) => {
      const key = m.key ?? `m${idx + 1}`;
      if (seenKeys.has(key)) {
        throw new McpInvalidError(`Duplicate meeting key: ${key}`);
      }
      seenKeys.add(key);

      const durationMinutes = m.durationMinutes ?? input.durationMinutes;
      const members = new Set<string>();
      if (m.groupId) {
        for (const uid of await resolveGroupMembers(m.groupId)) members.add(uid);
      }
      for (const uid of m.memberUserIds ?? []) members.add(uid);
      const required = new Set<string>();
      for (const uid of m.requiredUserIds ?? []) {
        required.add(uid);
        members.add(uid); // required implies member
      }
      if (members.size === 0) {
        throw new McpInvalidError(
          `Meeting "${key}" has no members — provide a groupId with members or a non-empty memberUserIds.`,
        );
      }
      const label = m.label ?? (m.groupId ? groupNames.get(m.groupId) : undefined) ?? key;
      return { key, label, groupId: m.groupId, durationMinutes, memberIds: [...members], requiredIds: [...required] };
    }),
  );

  // ── Compute free/busy once per distinct user ──────────────────────────────
  const allUserIds = Array.from(new Set(resolved.flatMap((m) => m.memberIds)));
  if (allUserIds.length > MAX_TOTAL_USERS) {
    throw new McpInvalidError(
      `Too many distinct members across meetings (${allUserIds.length} > ${MAX_TOTAL_USERS}). Split the request.`,
    );
  }

  const freeBusy = await Promise.all(
    allUserIds.map((uid) => computeUserFreeBusy(uid, windowStart, windowEnd, input.timezone)),
  );
  const fbByUser = new Map(freeBusy.map((f) => [f.userId, f]));

  const [userRows, starts] = [
    await prisma.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    }),
    candidateStarts(windowStart, windowEnd, input.timezone, dayStartHour, dayEndHour, slotMinutes, includeWeekends),
  ];
  if (starts.length > MAX_CANDIDATE_STARTS) {
    throw new McpInvalidError(
      `Too many candidate slots (${starts.length} > ${MAX_CANDIDATE_STARTS}). Narrow the window, widen slotMinutes, or tighten the day band.`,
    );
  }

  const participants = new Map(
    userRows.map((u) => {
      const fb = fbByUser.get(u.id);
      return [
        u.id,
        {
          userId: u.id,
          name: `${u.firstName} ${u.lastName}`.trim() || u.daliEmail || u.id,
          hasCalendar: fb?.hasCalendar ?? false,
          calendarError: fb?.calendarError ?? false,
        },
      ];
    }),
  );

  // ── Build viable candidate slots per meeting ──────────────────────────────
  const bandEnd = dayEndHour * 60;
  const optimizerMeetings: OptimizerMeeting[] = resolved.map((m) => {
    const durMs = m.durationMinutes * 60_000;
    const candidates = [] as OptimizerMeeting["candidates"];
    for (const s of starts) {
      if (s.localMinute + m.durationMinutes > bandEnd) continue; // must end within the band
      const endMs = s.startMs + durMs;
      if (endMs > windowEnd.getTime()) continue;
      // Hard constraint: every required member must be free.
      const requiredFree = m.requiredIds.every((uid) => {
        const fb = fbByUser.get(uid);
        return fb ? isFreeDuring(fb.free, s.startMs, endMs) : false;
      });
      if (!requiredFree) continue;
      const freeIds = m.memberIds.filter((uid) => {
        const fb = fbByUser.get(uid);
        return fb ? isFreeDuring(fb.free, s.startMs, endMs) : false;
      });
      if (freeIds.length === 0) continue;
      candidates.push({ startMs: s.startMs, endMs, freeIds });
    }
    return { key: m.key, memberIds: m.memberIds, candidates };
  });

  const result = optimizeMeetingSchedule(optimizerMeetings);

  // ── Shape output ──────────────────────────────────────────────────────────
  const resolvedByKey = new Map(resolved.map((m) => [m.key, m]));
  const localLabel = (ms: number) => formatDateTimeInZone(new Date(ms), input.timezone);

  const meetingsOut = result.meetings.map((r) => {
    const meta = resolvedByKey.get(r.key)!;
    const assumedIds = r.attendeeIds.filter((uid) => {
      const p = participants.get(uid);
      return p && (!p.hasCalendar || p.calendarError);
    });
    return {
      key: r.key,
      label: meta.label,
      groupId: meta.groupId ?? null,
      durationMinutes: meta.durationMinutes,
      memberCount: meta.memberIds.length,
      scheduled: r.slot != null,
      slot: r.slot
        ? {
            startIso: new Date(r.slot.startMs).toISOString(),
            endIso: new Date(r.slot.endMs).toISOString(),
            localLabel: localLabel(r.slot.startMs),
          }
        : null,
      attendance: {
        count: r.attendeeIds.length,
        memberCount: meta.memberIds.length,
        percentage: meta.memberIds.length
          ? Math.round((r.attendeeIds.length / meta.memberIds.length) * 100)
          : 0,
        userIds: r.attendeeIds,
      },
      // Members free at this slot but attending an overlapping meeting instead.
      doubleBooked: r.conflicts,
      // Members not free at the chosen slot.
      unavailable: r.unavailableIds,
      // Attendees whose availability is assumed (no linked calendar / sync error),
      // not confirmed — treat with caution.
      assumedAvailability: assumedIds,
      alternatives: r.alternatives.slice(0, alternativesPerMeeting).map((a) => ({
        startIso: new Date(a.startMs).toISOString(),
        endIso: new Date(a.endMs).toISOString(),
        localLabel: localLabel(a.startMs),
        freeCount: a.freeCount,
      })),
    };
  });

  const usersWithoutCalendar = [...participants.values()].filter((p) => !p.hasCalendar).map((p) => p.userId);
  const usersWithCalendarError = [...participants.values()].filter((p) => p.calendarError).map((p) => p.userId);
  const unscheduled = meetingsOut.filter((m) => !m.scheduled).map((m) => m.key);

  const notes: string[] = [];
  if (usersWithoutCalendar.length > 0) {
    notes.push(
      `${usersWithoutCalendar.length} member(s) have no linked calendar — their availability is assumed from working hours, not confirmed. See usersWithoutCalendar and each meeting's assumedAvailability.`,
    );
  }
  if (usersWithCalendarError.length > 0) {
    notes.push(`${usersWithCalendarError.length} member(s) have a calendar sync error, so their busy times may be stale.`);
  }
  if (unscheduled.length > 0) {
    notes.push(
      `${unscheduled.length} meeting(s) had no viable slot (no one free, or a required member never free within the window/day band): ${unscheduled.join(", ")}.`,
    );
  }

  return {
    window: {
      startIso: windowStart.toISOString(),
      endIso: windowEnd.toISOString(),
      timezone: input.timezone,
      dayStartHour,
      dayEndHour,
      includeWeekends,
      slotMinutes,
    },
    totalAttendance: result.totalAttendance,
    maxPossibleAttendance: result.maxPossibleAttendance,
    attendanceRate: result.maxPossibleAttendance
      ? Math.round((result.totalAttendance / result.maxPossibleAttendance) * 100)
      : 0,
    usersWithoutCalendar,
    usersWithCalendarError,
    unscheduledMeetings: unscheduled,
    participants: Object.fromEntries(
      [...participants.values()].map((p) => [p.userId, { name: p.name, hasCalendar: p.hasCalendar, calendarError: p.calendarError }]),
    ),
    meetings: meetingsOut,
    notes,
  };
}
