import type { Route } from "./+types/api.scheduled-meetings";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
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
} as const;

const CreateSchema = z.discriminatedUnion("scopeType", [
  z.object({ scopeType: z.literal("None"), ...Base }),
  z.object({ scopeType: z.literal("Group"), groupId: z.string().min(1), ...Base }),
  z.object({
    scopeType: z.literal("UserList"),
    participantUserIds: z.array(z.string().min(1)).min(1),
    ...Base,
  }),
]);

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
      },
      { status: 201 },
    ),
  );
}
