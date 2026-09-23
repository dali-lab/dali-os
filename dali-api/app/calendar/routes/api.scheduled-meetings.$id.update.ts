import type { Route } from "./+types/api.scheduled-meetings.$id.update";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { MAX_GUEST_EMAILS } from "~/calendar/lib/guest-emails";
import {
  updateScheduledMeeting,
  type ScheduledMeetingScope,
} from "~/lib/scheduled-meeting";

// Edit is deliberately narrower than create: title, time, location, description,
// and the guest list. Meeting type, project, note, and attendance mode are fixed
// once created.
const Base = {
  title: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(5).max(480),
  recurrenceRule: z.string().max(500).optional(),
  startTime: z.string().datetime().optional(),
  // Omitted leaves the stored value alone; "" clears it (here and on Google).
  location: z.string().trim().max(500).optional(),
  description: z.string().trim().max(5000).optional(),
  // People with no DALI profile, invited by address through the Google event.
  guestEmails: z.array(z.string().trim().email().max(320)).max(MAX_GUEST_EMAILS).optional(),
} as const;

const UpdateSchema = z.discriminatedUnion("scopeType", [
  z.object({ scopeType: z.literal("None"), ...Base }),
  z.object({
    scopeType: z.literal("Group"),
    groupId: z.string().min(1),
    // Guests on top of the group, so an edit keeps anyone invited individually.
    extraUserIds: z.array(z.string().min(1)).optional(),
    ...Base,
  }),
  z.object({
    scopeType: z.literal("UserList"),
    participantUserIds: z.array(z.string().min(1)).min(1),
    ...Base,
  }),
]);

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant") return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, UpdateSchema);
  if (body instanceof Response) return withCors(request, body);

  let scope: ScheduledMeetingScope;
  if (body.scopeType === "Group") {
    scope = { type: "Group", groupId: body.groupId, extraUserIds: body.extraUserIds };
  } else if (body.scopeType === "UserList") {
    scope = { type: "UserList", participantUserIds: body.participantUserIds };
  } else {
    scope = { type: "None" };
  }

  const result = await updateScheduledMeeting(params.id!, auth.user.sub, {
    title: body.title,
    durationMinutes: body.durationMinutes,
    scope,
    startTime: body.startTime,
    recurrenceRule: body.recurrenceRule,
    location: body.location,
    description: body.description,
    guestEmails: body.guestEmails,
  });

  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }

  return withCors(
    request,
    Response.json({ ok: true, meeting: result.meeting, gcalError: result.gcalError }),
  );
}
