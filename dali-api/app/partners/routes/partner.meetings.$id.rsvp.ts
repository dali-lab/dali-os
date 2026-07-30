import type { Route } from "./+types/partner.meetings.$id.rsvp";
import { prisma } from "~/lib/db";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";

// POST /partner/meetings/:id/rsvp  { response: "Accepted"|"Tentative"|"Declined" }
// A partner RSVPs to a shared meeting. Portal-scoped (never the member
// notification RSVP), stored in PartnerMeetingResponse.
const MAP: Record<string, "Accepted" | "Declined" | "Tentative"> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
  Accepted: "Accepted",
  Declined: "Declined",
  Tentative: "Tentative",
};

export async function action({ request, params }: Route.ActionArgs) {
  const { auth } = await requirePartner(request);
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: { id: true, projectId: true, partnerVisible: true, status: true },
  });
  if (
    !meeting ||
    !meeting.partnerVisible ||
    !meeting.projectId ||
    meeting.status === "Cancelled"
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await partnerHasProjectAccess(auth.user.sub, meeting.projectId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { response?: string }
    | null;
  const rsvp = body?.response ? MAP[body.response] : undefined;
  if (!rsvp) return Response.json({ error: "Invalid response" }, { status: 400 });

  await prisma.partnerMeetingResponse.upsert({
    where: {
      scheduledMeetingId_userId: {
        scheduledMeetingId: meeting.id,
        userId: auth.user.sub,
      },
    },
    create: {
      scheduledMeetingId: meeting.id,
      userId: auth.user.sub,
      rsvp,
      respondedAt: new Date(),
    },
    update: { rsvp, respondedAt: new Date() },
  });
  return Response.json({ ok: true, rsvp });
}
