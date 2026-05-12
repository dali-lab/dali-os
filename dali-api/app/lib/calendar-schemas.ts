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
export const UpdateWorkingHoursDaySchema = z.object({
  intent: z.literal("update-working-hours-day"),
  dayOfWeek,
  enabled: z.boolean(),
  startMinute: minuteOfDay,
  endMinute: minuteOfDay,
  location: z.enum(["InPerson", "Remote"]),
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

export const CalendarActionSchema = z.discriminatedUnion("intent", [
  UpdateWorkingHoursDaySchema,
  CopyWeekdaysSchema,
  ResetWorkingHoursSchema,
  SetEventBufferSchema,
  AddManualBlockSchema,
  UpdateManualBlockSchema,
  RemoveManualBlockSchema,
]);

export type CalendarAction = z.infer<typeof CalendarActionSchema>;
