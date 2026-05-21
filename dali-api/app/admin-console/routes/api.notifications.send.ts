import type { Route } from "./+types/api.notifications.send";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { resolveGroupMembers, resolveAllLabMembers } from "~/lib/groups";

const KindEnum = z.enum([
  "General",
  "MeetingInvite",
  "MeetingReminder",
  "SystemAnnouncement",
]);

// Composable audience: the recipient set is the UNION of any combination of
// "whole lab", any number of groups, and any number of individuals. At least
// one source must be present (enforced after resolution). `isTodo` + `dueAt`
// + `formId` power the Announcements composer: a todo surfaces in the
// recipient's Tasks sidebar / Home banner (see ~/lib/tasks), `dueAt` is its
// deadline, and `formId` optionally attaches a published form to fill.
const SendSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000).optional(),
  link: z.string().url().max(500).optional(),
  kind: KindEnum.optional(),
  isTodo: z.boolean().optional(),
  dueAt: z.string().datetime().optional(),
  formId: z.string().min(1).optional(),

  // Audience (mix freely; union is the recipient set).
  allMembers: z.boolean().optional(),
  groupIds: z.array(z.string().min(1)).optional(),
  userIds: z.array(z.string().min(1)).optional(),
});

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

  const groupIds = body.groupIds ?? [];
  const userIds = body.userIds ?? [];
  if (!body.allMembers && groupIds.length === 0 && userIds.length === 0) {
    return withCors(request, Response.json({ error: "Pick an audience" }, { status: 400 }));
  }

  // Union of every selected source.
  const collected: string[] = [...userIds];
  if (body.allMembers) {
    collected.push(...(await resolveAllLabMembers()));
  }
  for (const gid of groupIds) {
    collected.push(...(await resolveGroupMembers(gid)));
  }
  // Provenance hint only (single column): keep it when exactly one group and
  // nothing else drove the send; otherwise it's a mixed audience.
  const sourceGroupId =
    groupIds.length === 1 && !body.allMembers && userIds.length === 0
      ? groupIds[0]
      : null;

  // Dedupe and drop empties.
  const recipientIds = Array.from(new Set(collected.filter(Boolean)));
  if (recipientIds.length === 0) {
    return withCors(request, Response.json({ error: "No recipients resolved" }, { status: 400 }));
  }

  // A todo or an attached form only makes sense on an announcement. Validate
  // the form is published before attaching (it must be fillable, possibly by
  // people outside dali-api).
  if (body.formId) {
    const form = await prisma.form.findUnique({
      where: { id: body.formId },
      select: { id: true, published: true },
    });
    if (!form)
      return withCors(request, Response.json({ error: "Attached form not found" }, { status: 404 }));
    if (!form.published)
      return withCors(
        request,
        Response.json({ error: "Attach a published form (publish it first)." }, { status: 400 }),
      );
  }

  const now = new Date();
  const dueAt = body.dueAt ? new Date(body.dueAt) : null;
  const result = await prisma.notification.createMany({
    data: recipientIds.map((rid) => ({
      recipientUserId: rid,
      createdByUserId: auth.user.sub,
      kind: body.kind ?? "General",
      title: body.title,
      body: body.body ?? null,
      link: body.link ?? null,
      sourceGroupId,
      isTodo: body.isTodo ?? false,
      dueAt,
      formId: body.formId ?? null,
      createdAt: now,
    })),
  });

  return withCors(request, Response.json({ ok: true, count: result.count }, { status: 201 }));
}
