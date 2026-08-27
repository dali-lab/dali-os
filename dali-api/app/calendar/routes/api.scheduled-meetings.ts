import type { Route } from "./+types/api.scheduled-meetings";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { canViewForms } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import {
  createScheduledMeeting,
  type ScheduledMeetingScope,
} from "~/lib/scheduled-meeting";

const Base = {
  title: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(5).max(480),
  recurrenceRule: z.string().max(500).optional(),
  startTime: z.string().datetime().optional(),
  organizerCalendarLinkId: z.string().min(1).optional(),
  meetingType: z.enum(["Team", "Partner", "Other"]).optional(),
  meetingTypeLabel: z.string().trim().min(1).max(80).optional(),
  // Project-less meetingType meetings get a Lab-workspace note page instead of
  // a project one — see createScheduledMeeting in ~/lib/scheduled-meeting.
  // Invites still come only from the meeting's participant scope.
  projectId: z.string().min(1).optional(),
  // SelfCheckIn is independent of meeting notes — attendance rows fan out
  // whenever SelfCheckIn (or meetingType) is set; see createScheduledMeeting.
  attendanceMode: z.enum(["Roster", "SelfCheckIn"]).optional(),
  // Core-only marker that lifts the meeting onto the Core hub calendar without
  // changing its participant scope. Gated below, not by the schema.
  isCoreMeeting: z.boolean().optional(),
} as const;

const CreateSchema = z
  .discriminatedUnion("scopeType", [
    z.object({ scopeType: z.literal("None"), ...Base }),
    z.object({ scopeType: z.literal("Group"), groupId: z.string().min(1), ...Base }),
    z.object({
      scopeType: z.literal("UserList"),
      participantUserIds: z.array(z.string().min(1)).min(1),
      ...Base,
    }),
  ])
  .refine((v) => v.meetingType !== "Other" || !!v.meetingTypeLabel, {
    message: "meetingTypeLabel is required when meetingType is Other",
    path: ["meetingTypeLabel"],
  });

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant")
    return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, CreateSchema);
  if (body instanceof Response) return withCors(request, body);

  // Self check-in is Core / Admin / Instructor only (same gate as Forms).
  if (body.attendanceMode === "SelfCheckIn" && !(await canViewForms(auth.user.sub))) {
    return forbidden(request);
  }

  // isCoreMeeting is no longer a manual flag — the form sets it only when the
  // Core group is among the invited participants, which is what makes a meeting
  // "Core" (it then surfaces on the Core calendar). The group picker is already
  // visibility-gated, so there's no separate role check here.

  let scope: ScheduledMeetingScope;
  if (body.scopeType === "Group") {
    scope = { type: "Group", groupId: body.groupId };
  } else if (body.scopeType === "UserList") {
    scope = { type: "UserList", participantUserIds: body.participantUserIds };
  } else {
    scope = { type: "None" };
  }

  const result = await createScheduledMeeting({
    organizerId: auth.user.sub,
    organizerEmail: auth.user.email,
    title: body.title,
    durationMinutes: body.durationMinutes,
    scope,
    startTime: body.startTime,
    recurrenceRule: body.recurrenceRule,
    organizerCalendarLinkId: body.organizerCalendarLinkId,
    meetingType: body.meetingType,
    meetingTypeLabel: body.meetingTypeLabel,
    projectId: body.projectId,
    attendanceMode: body.attendanceMode,
    isCoreMeeting: body.isCoreMeeting,
  });

  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: 400 }));
  }

  return withCors(
    request,
    Response.json(
      {
        ok: true,
        meeting: result.meeting,
        notifiedCount: result.notifiedCount,
        gcalError: result.gcalError,
        notePageId: result.notePageId,
        checkInToken: result.checkInToken,
      },
      { status: 201 },
    ),
  );
}
