import type { Route } from "./+types/api.notifications.send";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { sendAnnouncement } from "~/lib/announcements.server";
import { renderAnnouncementBody } from "~/collab/blocknote-server";

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
  // Rich body authored in the composer's DocEditor. When present it supersedes
  // `body`: the server converts it once to a plain-text mirror + email-safe HTML.
  bodyBlocks: z.array(z.any()).max(500).optional(),
  link: z.string().url().max(500).optional(),
  kind: KindEnum.optional(),
  isTodo: z.boolean().optional(),
  dueAt: z.string().datetime().optional(),
  formId: z.string().min(1).optional(),
  sendAt: z.string().datetime().optional(),
  // Also email each recipient's Dartmouth address (in addition to DALI).
  ccDartmouth: z.boolean().optional(),

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

  // Resolve the message body once for both the instant and scheduled paths:
  // a rich `bodyBlocks` payload becomes a plain-text mirror (in-app/Slack) plus
  // sanitized email HTML; a whitespace-only result is treated as no body.
  let bodyText: string | null = body.body ?? null;
  let bodyHtml: string | null = null;
  if (body.bodyBlocks && body.bodyBlocks.length > 0) {
    if (JSON.stringify(body.bodyBlocks).length > 100_000) {
      return withCors(request, Response.json({ error: "Message body too large." }, { status: 400 }));
    }
    try {
      const rendered = await renderAnnouncementBody(
        body.bodyBlocks as Parameters<typeof renderAnnouncementBody>[0],
      );
      const hasContent = rendered.text.trim().length > 0;
      bodyText = hasContent ? rendered.text : null;
      bodyHtml = hasContent ? rendered.html : null;
    } catch (err) {
      console.error("[announcements] body render failed:", err);
      return withCors(
        request,
        Response.json({ error: "Couldn't render the message body." }, { status: 400 }),
      );
    }
  }

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
        body: bodyText,
        bodyHtml,
        link: body.link ?? null,
        kind: body.kind ?? "General",
        isTodo: body.isTodo ?? false,
        dueAt,
        formId: body.formId ?? null,
        ccDartmouth: body.ccDartmouth ?? false,
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
    body: bodyText,
    bodyHtml,
    link: body.link ?? null,
    kind: body.kind ?? "General",
    isTodo: body.isTodo ?? false,
    dueAt,
    formId: body.formId ?? null,
    ccDartmouth: body.ccDartmouth ?? false,
    allMembers: body.allMembers ?? false,
    groupIds,
    userIds,
  });
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json({ ok: true, count: result.count }, { status: 201 }));
}
