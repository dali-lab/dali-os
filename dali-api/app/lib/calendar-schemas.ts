import { z } from "zod";

// Minutes from local midnight: 0..1440 (inclusive end allowed for endMinute).
const minuteOfDay = z.number().int().min(0).max(1440);

const dayOfWeek = z.number().int().min(0).max(6);

const isoString = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  "must be an ISO datetime",
);

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

export const AddManualBlockSchema = z.object({
  intent: z.literal("add-manual-block"),
  title: z.string().min(1).max(200),
  startTime: isoString,
  endTime: isoString,
  allDay: z.boolean().optional().default(false),
  recurrenceRule: z.string().max(500).nullish(),
});

export const UpdateManualBlockSchema = z.object({
  intent: z.literal("update-manual-block"),
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  startTime: isoString.optional(),
  endTime: isoString.optional(),
  allDay: z.boolean().optional(),
  recurrenceRule: z.string().max(500).nullish(),
});

export const RemoveManualBlockSchema = z.object({
  intent: z.literal("remove-manual-block"),
  id: z.string().min(1),
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

// Manual Timesheet-tab entries only — Meeting-sourced TimeEntry rows are
// managed exclusively by the attendance-toggle route
// (app/calendar/routes/api.scheduled-meetings.$id.attendance.ts).
export const AddTimeEntrySchema = z.object({
  intent: z.literal("add-time-entry"),
  date: isoString,
  hours: z.number().positive().max(24),
  projectId: z.string().min(1).nullish(),
  note: z.string().max(500).nullish(),
  // Set when the entry was created by dragging on the Timesheet week grid;
  // null for the plain date+hours form (no time-of-day picked).
  startTime: isoString.nullish(),
  endTime: isoString.nullish(),
});

export const UpdateTimeEntrySchema = z.object({
  intent: z.literal("update-time-entry"),
  id: z.string().min(1),
  date: isoString.optional(),
  hours: z.number().positive().max(24).optional(),
  projectId: z.string().min(1).nullish(),
  note: z.string().max(500).nullish(),
  startTime: isoString.nullish(),
  endTime: isoString.nullish(),
});

export const DeleteTimeEntrySchema = z.object({
  intent: z.literal("delete-time-entry"),
  id: z.string().min(1),
});

export const CalendarActionSchema = z.discriminatedUnion("intent", [
  SetWorkingSegmentsSchema,
  SeedWorkingHoursSchema,
  CopyWeekdaysSchema,
  ResetWorkingHoursSchema,
  SetEventBufferSchema,
  AddManualBlockSchema,
  UpdateManualBlockSchema,
  RemoveManualBlockSchema,
  RemoveCalendarLinkSchema,
  ToggleSubCalendarSchema,
  AddTimeEntrySchema,
  UpdateTimeEntrySchema,
  DeleteTimeEntrySchema,
]);

export type CalendarAction = z.infer<typeof CalendarActionSchema>;
