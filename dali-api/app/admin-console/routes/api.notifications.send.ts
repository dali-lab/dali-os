import type { Route } from "./+types/api.notifications.send";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { resolveGroupMembers } from "~/lib/groups";

const KindEnum = z.enum(["General", "MeetingInvite", "MeetingReminder", "SystemAnnouncement"]);

const SendSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("Individuals"),
    userIds: z.array(z.string().min(1)).min(1),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(2000).optional(),
    link: z.string().url().max(500).optional(),
    kind: KindEnum.optional(),
  }),
  z.object({
    mode: z.literal("Group"),
    groupId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(2000).optional(),
    link: z.string().url().max(500).optional(),
    kind: KindEnum.optional(),
  }),
]);

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, SendSchema);
  if (body instanceof Response) return withCors(request, body);

  let recipientIds: string[];
  let sourceGroupId: string | null = null;
  if (body.mode === "Group") {
    recipientIds = await resolveGroupMembers(body.groupId);
    sourceGroupId = body.groupId;
  } else {
    recipientIds = body.userIds;
  }

  // Dedupe and drop empties.
  recipientIds = Array.from(new Set(recipientIds.filter(Boolean)));
  if (recipientIds.length === 0) {
    return withCors(request, Response.json({ error: "No recipients resolved" }, { status: 400 }));
  }

  const now = new Date();
  const result = await prisma.notification.createMany({
    data: recipientIds.map((rid) => ({
      recipientUserId: rid,
      createdByUserId: auth.user.sub,
      kind: body.kind ?? "General",
      title: body.title,
      body: body.body ?? null,
      link: body.link ?? null,
      sourceGroupId,
      createdAt: now,
    })),
  });

  return withCors(request, Response.json({ ok: true, count: result.count }, { status: 201 }));
}
