import type { Route } from "./+types/api.offerings.$id.announcements";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { notifyAnnouncement } from "~/education/lib/notifications";
import { loadOfferingRoster } from "~/lib/mentions.server";
import { resolveMentions } from "~/lib/mentions";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return Response.json({ error: "body required" }, { status: 400 });

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  if (!offering) return Response.json({ error: "Offering not found" }, { status: 404 });

  const author = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  });
  const authorName = `${author?.firstName ?? ""} ${author?.lastName ?? ""}`.trim() || "DALI Education";

  const created = await prisma.educationAnnouncement.create({
    data: {
      offeringId: offering.id,
      authorId: auth.user.sub,
      body: text,
    },
  });

  const roster = await loadOfferingRoster(offering.id);
  const mentions = resolveMentions(text, roster);
  const fanout = await notifyAnnouncement({
    offeringId: offering.id,
    offeringTitle: offering.title,
    authorName,
    body: text,
    enrolledLink: `/education/enrolled/${offering.id}`,
    extraRecipientUserIds: mentions.map((m) => m.userId),
  });

  await logAuditEvent({
    action: "education.announcement.create",
    userId: auth.user.sub,
    targetId: created.id,
    metadata: { offeringId: offering.id, recipients: fanout.recipients, emailsSent: fanout.emailsSent },
    request,
  });

  return Response.json({ announcement: created, fanout }, { status: 201 });
}
