import { prisma } from "~/lib/db.server";
import { addTimeEntry, deleteTimeEntry, timeEntryResult, updateTimeEntry } from "~/calendar/lib/time-entries.server";
import { removeTimeEntryFromGoogle } from "~/calendar/lib/timesheet-mirror.server";
import {
  attachMeetingNote,
  attachMeetingWhiteboard,
  setMeetingProject,
  trackExternalEventAsMeeting,
} from "~/calendar/lib/scheduled-meeting.server";
import { resolveMeetingOccurrence } from "~/calendar/lib/meeting-roster.server";
import { parseOccurrenceParam } from "~/calendar/lib/meeting-occurrences";
import { meetingNotePath } from "~/lib/note-path.server";
import type { CalendarActionContext, CalendarIntentInput } from "~/calendar/lib/calendar-actions/shared.server";
import { canActOnMeeting } from "~/calendar/lib/calendar-external.server";

export async function handleAddTimeEntry(
  input: CalendarIntentInput<"add-time-entry">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  const result = await addTimeEntry(userId, input);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, entry: timeEntryResult(result.entry) });
}

export async function handleUpdateTimeEntry(
  input: CalendarIntentInput<"update-time-entry">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  const result = await updateTimeEntry(userId, input);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, entry: timeEntryResult(result.entry) });
}

export async function handleDeleteTimeEntry(
  input: CalendarIntentInput<"delete-time-entry">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  const result = await deleteTimeEntry(userId, input.id);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, entry: { id: result.id } });
}

export async function handleToggleMeetingTimeEntry(
  input: CalendarIntentInput<"toggle-meeting-time-entry">,
  { userId, request }: CalendarActionContext,
): Promise<Response | null> {
  // Only a participant (or the organizer) may log the meeting, and only on
  // their own timesheet — userId comes from the session, never the form.
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      status: true,
      projectId: true,
      durationMinutes: true,
      selectedAt: true,
      createdAt: true,
      recurrenceRule: true,
      externalEventId: true,
      organizerId: true,
      participantUserIds: true,
      scopeType: true,
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canActOnMeeting(meeting, userId, request))) {
    return Response.json({ error: "You weren't invited to this meeting" }, { status: 403 });
  }
  const occurrence = await resolveMeetingOccurrence(meeting, parseOccurrenceParam(input.occurrence));
  const key = { scheduledMeetingId: meeting.id, occurrenceStart: occurrence.originalStart, userId };
  if (!input.onTimesheet) {
    // Clean up the Google mirror event (if any) before removing the row.
    const existing = await prisma.timeEntry.findUnique({
      where: { scheduledMeetingId_occurrenceStart_userId: key },
    });
    if (existing) await removeTimeEntryFromGoogle(existing).catch(() => {});
    await prisma.timeEntry.deleteMany({ where: key });
    return null;
  }
  if (!meeting.selectedAt) {
    return Response.json(
      { error: "This meeting doesn't have a scheduled time yet" },
      { status: 400 },
    );
  }
  const startTime = occurrence.start;
  const endTime = occurrence.end;
  const hours = (endTime.getTime() - startTime.getTime()) / 3_600_000;
  // Same shape attendance produces (`markMeetingAttendance`), minus the
  // MeetingAttendance flip — logging your own hours isn't a claim that the
  // organizer marked you present. The role is left unset: the Timesheet
  // edit popover is where it gets attributed, as with attendance rows.
  // Not mirrored to the DALI Timesheet calendar: a meeting is a real event
  // that already lives on the organizer's/attendees' calendars, so a second
  // copy on the Timesheet calendar would just duplicate it. Meeting-logged
  // time surfaces in DALI as a role accent on the meeting block instead.
  await prisma.timeEntry.upsert({
    where: { scheduledMeetingId_occurrenceStart_userId: key },
    create: {
      ...key,
      source: "Meeting",
      projectId: meeting.projectId,
      date: startTime,
      hours,
      startTime,
      endTime,
    },
    update: { projectId: meeting.projectId, date: startTime, hours, startTime, endTime },
  });
  return null;
}

export async function handleSetMeetingProject(
  input: CalendarIntentInput<"set-meeting-project">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  // setMeetingProject checks organizer/Core + project membership.
  const result = await setMeetingProject({
    meetingId: input.meetingId,
    actorId: userId,
    projectId: input.projectId,
    meetingType: input.meetingType,
    meetingTypeLabel: input.meetingTypeLabel ?? null,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true });
}

export async function handleAddMeetingNote(
  input: CalendarIntentInput<"add-meeting-note">,
  { userId, request }: CalendarActionContext,
): Promise<Response | null> {
  const result = await attachMeetingNote({
    meetingId: input.meetingId,
    actorId: userId,
    occurrence: parseOccurrenceParam(input.occurrence),
    meetingType: input.meetingType,
    meetingTypeLabel: input.meetingTypeLabel ?? null,
    projectId: input.projectId ?? null,
    notebook: input.notebook ?? null,
    request,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({
    ok: true,
    notePageId: result.notePageId,
    notebookId: result.notebookId,
    createdNotebook: result.createdNotebook,
    seriesNotebookId: result.seriesNotebookId,
    notePath: await meetingNotePath({
      notePageId: result.notePageId,
      notebookId: result.notebookId,
      viewerSub: userId,
      request,
    }),
  });
}

export async function handleAddMeetingWhiteboard(
  input: CalendarIntentInput<"add-meeting-whiteboard">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  const result = await attachMeetingWhiteboard({
    meetingId: input.meetingId,
    actorId: userId,
    meetingType: input.meetingType ?? null,
    meetingTypeLabel: input.meetingTypeLabel ?? null,
    projectId: input.projectId ?? null,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, whiteboardPageId: result.whiteboardPageId });
}

export async function handleTrackEventAsMeeting(
  input: CalendarIntentInput<"track-event-as-meeting">,
  { userId }: CalendarActionContext,
): Promise<Response | null> {
  // Core or someone on the event, re-checked inside — the popover's button
  // is a hint and the server decides.
  const result = await trackExternalEventAsMeeting({
    actorId: userId,
    eventId: input.eventId,
    recurringEventId: input.recurringEventId ?? null,
    linkId: input.linkId,
    calendarId: input.calendarId,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, meetingId: result.meeting.id });
}
