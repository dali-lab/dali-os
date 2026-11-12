import { prisma } from "~/lib/db.server";
import { setSubCalendarEnabled } from "~/calendar/lib/sub-calendar.server";
import { setUserTimesheetSync } from "~/lib/timesheet-mirror.server";
import { subscribeCalendarForLink } from "~/lib/google-calendar";
import { generalCalendarId } from "~/lib/general-calendar";
import type { CalendarActionContext, CalendarIntentInput } from "~/calendar/lib/calendar-actions/shared.server";

export async function handleSetWorkingSegments(
  input: CalendarIntentInput<"set-working-segments">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  // Validate each segment's bounds and clamp.
  for (const s of input.segments) {
    if (s.startMinute >= s.endMinute) {
      return Response.json({ error: "startMinute must be < endMinute" }, { status: 400 });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.workingHoursDay.deleteMany({
      where: { userId, dayOfWeek: input.dayOfWeek },
    });
    if (input.segments.length > 0) {
      await tx.workingHoursDay.createMany({
        data: input.segments.map((s) => ({
          userId,
          dayOfWeek: input.dayOfWeek,
          enabled: true,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
          location: s.location,
        })),
      });
    } else {
      // Sentinel row that records "user explicitly cleared this day."
      // The loader skips disabled rows for availability calc but uses their
      // existence to distinguish "explicit empty" from "never set."
      await tx.workingHoursDay.create({
        data: {
          userId,
          dayOfWeek: input.dayOfWeek,
          enabled: false,
          startMinute: 0,
          endMinute: 1,
          location: "InPerson",
        },
      });
    }
  });
  return null;
}

export async function handleCopyWeekdays(
  input: CalendarIntentInput<"copy-weekdays">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  // Copy all of Monday's segments to Tue–Fri.
  const mondaySegments = await prisma.workingHoursDay.findMany({
    where: { userId, dayOfWeek: 1, enabled: true },
    select: { startMinute: true, endMinute: true, location: true, enabled: true },
  });
  if (mondaySegments.length === 0) return null;
  const tuesToFri = [2, 3, 4, 5];
  await prisma.$transaction(async (tx) => {
    await tx.workingHoursDay.deleteMany({
      where: { userId, dayOfWeek: { in: tuesToFri } },
    });
    await tx.workingHoursDay.createMany({
      data: tuesToFri.flatMap((dow) =>
        mondaySegments.map((s) => ({
          userId,
          dayOfWeek: dow,
          enabled: s.enabled,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
          location: s.location,
        })),
      ),
    });
  });
  return null;
}

export async function handleResetWorkingHours(
  input: CalendarIntentInput<"reset-working-hours">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  await prisma.workingHoursDay.deleteMany({ where: { userId } });
  return null;
}

export async function handleSeedWorkingHours(
  input: CalendarIntentInput<"seed-working-hours">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  // Materialize the supplied full-week segment set in one transaction. Used
  // when the user first turns Working Hours on or resets them: persisting
  // a single day would leave the other days with no rows, and the loader's
  // "hasAnyPersisted ⇒ unlisted day is empty" rule would then silently wipe
  // the default Mon–Fri hours. Seeding all days at once keeps them.
  for (const d of input.days) {
    for (const s of d.segments) {
      if (s.startMinute >= s.endMinute) {
        return Response.json({ error: "startMinute must be < endMinute" }, { status: 400 });
      }
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.workingHoursDay.deleteMany({ where: { userId } });
    const rows = input.days.flatMap((d) =>
      d.segments.length > 0
        ? d.segments.map((s) => ({
            userId,
            dayOfWeek: d.dayOfWeek,
            enabled: true,
            startMinute: s.startMinute,
            endMinute: s.endMinute,
            location: s.location,
          }))
        : [
            // Sentinel "explicitly empty" row, same as set-working-segments.
            {
              userId,
              dayOfWeek: d.dayOfWeek,
              enabled: false,
              startMinute: 0,
              endMinute: 1,
              location: "InPerson" as const,
            },
          ],
    );
    if (rows.length > 0) await tx.workingHoursDay.createMany({ data: rows });
  });
  return null;
}

export async function handleSetEventBuffer(
  input: CalendarIntentInput<"set-event-buffer">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  await prisma.userAvailabilitySettings.upsert({
    where: { userId },
    create: { userId, defaultEventBufferMin: input.defaultEventBufferMin },
    update: { defaultEventBufferMin: input.defaultEventBufferMin },
  });
  return null;
}

export async function handleRemoveCalendarLink(
  input: CalendarIntentInput<"remove-calendar-link">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
  if (!link || link.userId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.userCalendarLink.delete({ where: { id: input.linkId } });
  return null;
}

export async function handleToggleSubCalendar(
  input: CalendarIntentInput<"toggle-sub-calendar">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
  if (!link || link.userId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await setSubCalendarEnabled(input.linkId, input.calendarId, input.enabled);
  return null;
}

export async function handleSubscribeGeneralCalendar(
  input: CalendarIntentInput<"subscribe-general-calendar">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  const generalId = generalCalendarId();
  if (!generalId) {
    return Response.json({ error: "No DALI calendar is configured" }, { status: 400 });
  }
  const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
  if (!link || link.userId !== userId || link.provider !== "Google") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await subscribeCalendarForLink(link.id, generalId);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Couldn't add the DALI calendar" },
      { status: 502 },
    );
  }
  return null;
}

export async function handleSetTimesheetSync(
  input: CalendarIntentInput<"set-timesheet-sync">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  const result = await setUserTimesheetSync(userId, input.enabled);
  if (!result.ok && result.reason === "needsDaliLink") {
    return Response.json(
      { error: "Connect your @dali.dartmouth.edu Google account first.", needsDaliLink: true },
      { status: 400 },
    );
  }
  if (!result.ok) return Response.json({ error: result.message }, { status: 502 });
  return null;
}
