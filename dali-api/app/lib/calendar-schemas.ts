import { z } from "zod";

// Minutes from local midnight: 0..1440 (inclusive end allowed for endMinute).
const minuteOfDay = z.number().int().min(0).max(1440);

const dayOfWeek = z.number().int().min(0).max(6);

const isoString = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  "must be an ISO datetime",
);

// Mirrors the Prisma AssignmentType enum. Paired with roleRefId to identify
// which concrete ProjectAssignment/CoreAssignment/InstructorAssignment/
// DomainLeadAssignment/AdminMembership row a TimeEntry or work ManualBlock is
// attributed to — untyped at the DB layer, dispatched in app code, same
// pattern as ScheduledMeeting.scopeType/scopeId.
const assignmentType = z.enum(["Project", "Core", "Instructor", "DomainLead", "Admin"]);

// Each intent is a discriminated variant so the action handler can switch on it.
// Cross-field checks (e.g. start < end) are enforced by the action handler, not the
// schema — Zod 4 forbids refined objects inside a discriminatedUnion.

// Full-replace for a single day: wipes the user's existing rows for that
// day-of-week and inserts the provided segments (possibly empty for "unavailable").
export const SetWorkingSegmentsSchema = z.object({
  intent: z.literal("set-working-segments"),
  dayOfWeek,
  segments: z
    .array(
      z.object({
        startMinute: minuteOfDay,
        endMinute: minuteOfDay,
        location: z.enum(["InPerson", "Remote"]),
      }),
    )
    .max(24),
});

// Full-replace for the entire week in one transaction. Used when the user first
// turns Working Hours on / edits a day while the state is still the in-memory
// default, so all seven days get materialized together (otherwise the loader
// would treat the un-persisted days as "explicitly empty"). Empty segments for a
// day mean "unavailable", same as set-working-segments.
export const SeedWorkingHoursSchema = z.object({
  intent: z.literal("seed-working-hours"),
  days: z
    .array(
      z.object({
        dayOfWeek,
        segments: z
          .array(
            z.object({
              startMinute: minuteOfDay,
              endMinute: minuteOfDay,
              location: z.enum(["InPerson", "Remote"]),
            }),
          )
          .max(24),
      }),
    )
    .max(7),
});

// Copy Monday's hours to Tue–Fri. Sat/Sun untouched.
export const CopyWeekdaysSchema = z.object({
  intent: z.literal("copy-weekdays"),
});

export const ResetWorkingHoursSchema = z.object({
  intent: z.literal("reset-working-hours"),
});

export const SetEventBufferSchema = z.object({
  intent: z.literal("set-event-buffer"),
  // 0 means "none". UI offers 0/5/10/15/30/45/60 today; we accept any non-negative int up to a sane cap.
  defaultEventBufferMin: z.number().int().min(0).max(240),
});

export const RemoveCalendarLinkSchema = z.object({
  intent: z.literal("remove-calendar-link"),
  linkId: z.string().min(1),
});

export const ToggleSubCalendarSchema = z.object({
  intent: z.literal("toggle-sub-calendar"),
  linkId: z.string().min(1),
  calendarId: z.string().min(1),
  enabled: z.boolean(),
});

// Add the shared DALI General Calendar to one linked Google account. The
// calendar id comes from env server-side, so the form only names the account.
export const SubscribeGeneralCalendarSchema = z.object({
  intent: z.literal("subscribe-general-calendar"),
  linkId: z.string().min(1),
});

// Timesheet-tab entries. Meeting / Block rows are also created by attendance
// and manual-block sync, but the timesheet edit popover can update or delete
// any owned TimeEntry (Block updates also mirror the linked ManualBlock).
export const AddTimeEntrySchema = z.object({
  intent: z.literal("add-time-entry"),
  date: isoString,
  hours: z.number().positive().max(24),
  // Which concrete paid role this entry is attributed to (see assignmentType
  // above). Required: every logged hour bills to a real role, so there's no
  // "unassigned" path in (legacy rows predating this may still be null).
  assignmentType,
  roleRefId: z.string().min(1),
  note: z.string().max(500).nullish(),
  // Required: manual entries always carry a real time-of-day range now,
  // whether dragged on the grid or typed into the add form.
  startTime: isoString,
  endTime: isoString,
  // Set when the entry is logged against a just-created meeting (the unified
  // Create modal's "count as work"): links it to the meeting so it renders as a
  // role accent on the meeting block instead of a duplicate, and skips the
  // Timesheet-calendar mirror (the meeting already lives on the real calendar).
  scheduledMeetingId: z.string().optional(),
});

export const UpdateTimeEntrySchema = z.object({
  intent: z.literal("update-time-entry"),
  id: z.string().min(1),
  date: isoString.optional(),
  hours: z.number().positive().max(24).optional(),
  assignmentType: assignmentType.optional(),
  roleRefId: z.string().min(1).optional(),
  note: z.string().max(500).nullish(),
  startTime: isoString.optional(),
  endTime: isoString.optional(),
});

// Cross-field rules for a manual TimeEntry's time range. Kept out of the
// schemas themselves because CalendarActionSchema is a discriminatedUnion,
// which needs plain ZodObjects to narrow on `intent`. Callers run this after
// parsing and surface the message verbatim.
//
// `hours` is always derived from start/end on the client, but it's re-checked
// rather than trusted: a hand-rolled POST could otherwise log 8h against a
// 30-minute window.
const HOURS_TOLERANCE = 0.02; // ~1 minute of float/rounding slack

export function validateTimeEntryRange(v: {
  startTime?: string | null;
  endTime?: string | null;
  hours?: number | null;
}): string | null {
  if (!v.startTime || !v.endTime) return null;
  const start = new Date(v.startTime).getTime();
  const end = new Date(v.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Invalid start or end time";
  if (end <= start) return "End time must be after start time";
  const derived = (end - start) / 3_600_000;
  if (derived > 24) return "An entry can't be longer than 24 hours";
  if (typeof v.hours === "number" && Math.abs(derived - v.hours) > HOURS_TOLERANCE) {
    return "Hours must match the start/end range";
  }
  return null;
}

export const DeleteTimeEntrySchema = z.object({
  intent: z.literal("delete-time-entry"),
  id: z.string().min(1),
});

// "Add to timesheet" on a meeting's detail popover: creates/removes the
// Meeting-sourced TimeEntry for the viewer only. Deliberately does NOT touch
// MeetingAttendance — logging your own hours isn't the same claim as the
// organizer recording that you were present.
export const ToggleMeetingTimeEntrySchema = z.object({
  intent: z.literal("toggle-meeting-time-entry"),
  meetingId: z.string().min(1),
  onTimesheet: z.boolean(),
});

// "Mark as a Core meeting" on a meeting's detail popover — the same flag the
// create form sets, editable after the fact. Core-only; the action re-checks.
export const SetMeetingCoreSchema = z.object({
  intent: z.literal("set-meeting-core"),
  meetingId: z.string().min(1),
  isCoreMeeting: z.boolean(),
});

// "Mirror my timesheet to Google" opt-in toggle (Calendars panel). Persists the
// flag on UserAvailabilitySettings and, on enable, lazily provisions the DALI
// Timesheet Google calendar (see timesheet-mirror.server.ts).
export const SetTimesheetSyncSchema = z.object({
  intent: z.literal("set-timesheet-sync"),
  enabled: z.boolean(),
});

export const CalendarActionSchema = z.discriminatedUnion("intent", [
  SetWorkingSegmentsSchema,
  SeedWorkingHoursSchema,
  CopyWeekdaysSchema,
  ResetWorkingHoursSchema,
  SetEventBufferSchema,
  RemoveCalendarLinkSchema,
  ToggleSubCalendarSchema,
  SubscribeGeneralCalendarSchema,
  AddTimeEntrySchema,
  UpdateTimeEntrySchema,
  DeleteTimeEntrySchema,
  ToggleMeetingTimeEntrySchema,
  SetMeetingCoreSchema,
  SetTimesheetSyncSchema,
]);

export type CalendarAction = z.infer<typeof CalendarActionSchema>;
