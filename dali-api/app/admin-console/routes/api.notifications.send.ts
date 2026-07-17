import type { Route } from "./+types/api.notifications.send";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { sendAnnouncement } from "~/lib/announcements.server";

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
// `sendAt` (future instant) schedules instead of sending — the row waits in
// ScheduledAnnouncement until the scheduled-announcements job fires it.
const SendSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000).optional(),
  link: z.string().url().max(500).optional(),
  kind: KindEnum.optional(),
  isTodo: z.boolean().optional(),
  dueAt: z.string().datetime().optional(),
  formId: z.string().min(1).optional(),
  sendAt: z.string().datetime().optional(),

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
  if (!(await isCore(auth.user.sub)))
    return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, SendSchema);
  if (body instanceof Response) return withCors(request, body);

  const groupIds = body.groupIds ?? [];
  const userIds = body.userIds ?? [];
  const dueAt = body.dueAt ? new Date(body.dueAt) : null;

  // Schedule instead of send when sendAt is in the future.
  const sendAt = body.sendAt ? new Date(body.sendAt) : null;
  if (sendAt && sendAt.getTime() > Date.now()) {
    if (!body.allMembers && groupIds.length === 0 && userIds.length === 0) {
      return withCors(request, Response.json({ error: "Pick an audience" }, { status: 400 }));
    }
    // Validate the form now too — a broken attachment should fail at compose
    // time, not silently at fire time (the job re-validates regardless).
    if (body.formId) {
      const form = await prisma.form.findUnique({
        where: { id: body.formId },
        select: { published: true },
      });
      if (!form)
        return withCors(request, Response.json({ error: "Attached form not found" }, { status: 404 }));
      if (!form.published)
        return withCors(
          request,
          Response.json({ error: "Attach a published form (publish it first)." }, { status: 400 }),
        );
    }
    const scheduled = await prisma.scheduledAnnouncement.create({
      data: {
        createdByUserId: auth.user.sub,
        title: body.title,
        body: body.body ?? null,
        link: body.link ?? null,
        kind: body.kind ?? "General",
        isTodo: body.isTodo ?? false,
        dueAt,
        formId: body.formId ?? null,
        allMembers: body.allMembers ?? false,
        groupIds,
        userIds,
        sendAt,
      },
      select: { id: true, sendAt: true },
    });
    return withCors(
      request,
      Response.json({ ok: true, scheduled: true, id: scheduled.id }, { status: 201 }),
    );
  }

  const result = await sendAnnouncement({
    createdByUserId: auth.user.sub,
    title: body.title,
    body: body.body ?? null,
    link: body.link ?? null,
    kind: body.kind ?? "General",
    isTodo: body.isTodo ?? false,
    dueAt,
    formId: body.formId ?? null,
    allMembers: body.allMembers ?? false,
    groupIds,
    userIds,
  });
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json({ ok: true, count: result.count }, { status: 201 }));
}
