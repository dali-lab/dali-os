import type { Route } from "./+types/api.pages.$id.template";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { getPageAccess } from "~/lib/pageAccess.server";
import { isCore, isProjectMember } from "~/lib/roles";

// POST /api/pages/:id/template
//
// Three intents on a FreeForm Page:
//   setTemplate                   Toggle isTemplate itself.
//   setProjectMeetingNoteTemplate Bind/unbind this page (must already be a
//     template, in a Project's Drive) as that project's meeting-note
//     template — Project.meetingNoteTemplateId. Edit access to the project
//     (Core, or staffed on it) required.
//   setLabMeetingNoteDefault      Bind/unbind this page (must already be a
//     template, in the Lab Drive) as the lab-wide default meeting-note
//     template for one meeting type — Page.defaultMeetingNoteFor. Core only;
//     binding moves the marker off whichever page held it before.
// See specs/meeting-notes-model.md §1.

const BodySchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("setTemplate"), isTemplate: z.boolean() }),
  z.object({ intent: z.literal("setProjectMeetingNoteTemplate"), active: z.boolean() }),
  z.object({
    intent: z.literal("setLabMeetingNoteDefault"),
    meetingType: z.enum(["Team", "Partner", "Other"]),
    active: z.boolean(),
  }),
]);

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return withCors(request, Response.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const page = await prisma.page.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      kind: true,
      isTemplate: true,
    },
  });
  if (!page || page.archivedAt !== null) {
    return withCors(request, Response.json({ error: "Page not found" }, { status: 404 }));
  }
  if (page.kind !== "FreeForm") {
    return withCors(
      request,
      Response.json({ error: "Only FreeForm pages can be templates" }, { status: 400 }),
    );
  }

  if (body.intent === "setTemplate") {
    const access = await getPageAccess(auth.user.sub, {
      id: page.id,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      archivedAt: page.archivedAt,
    });
    if (!access.canEdit) {
      return withCors(request, Response.json({ error: "Permission denied" }, { status: 403 }));
    }
    await prisma.page.update({ where: { id: params.id }, data: { isTemplate: body.isTemplate } });
    return withCors(request, Response.json({ ok: true }));
  }

  if (!page.isTemplate) {
    return withCors(
      request,
      Response.json({ error: "Mark this page as a template first" }, { status: 400 }),
    );
  }

  if (body.intent === "setProjectMeetingNoteTemplate") {
    if (page.workspaceType !== "Project" || !page.workspaceId) {
      return withCors(request, Response.json({ error: "Not a project document" }, { status: 400 }));
    }
    const core = await isCore(auth.user.sub);
    const canEditProject = core || (await isProjectMember(auth.user.sub, page.workspaceId));
    if (!canEditProject) {
      return withCors(request, Response.json({ error: "Permission denied" }, { status: 403 }));
    }
    if (body.active) {
      await prisma.project.update({
        where: { id: page.workspaceId },
        data: { meetingNoteTemplateId: page.id },
      });
    } else {
      // Conditional: only clear if this page still holds the binding, so an
      // unrelated clear request can't race another page's bind.
      await prisma.project.updateMany({
        where: { id: page.workspaceId, meetingNoteTemplateId: page.id },
        data: { meetingNoteTemplateId: null },
      });
    }
    return withCors(request, Response.json({ ok: true }));
  }

  // setLabMeetingNoteDefault
  if (page.workspaceType !== "Lab") {
    return withCors(request, Response.json({ error: "Not a Lab document" }, { status: 400 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Permission denied" }, { status: 403 }));
  }
  if (body.active) {
    await prisma.page.updateMany({
      where: { defaultMeetingNoteFor: body.meetingType, id: { not: page.id } },
      data: { defaultMeetingNoteFor: null },
    });
    await prisma.page.update({
      where: { id: page.id },
      data: { defaultMeetingNoteFor: body.meetingType },
    });
  } else {
    await prisma.page.update({ where: { id: page.id }, data: { defaultMeetingNoteFor: null } });
  }
  return withCors(request, Response.json({ ok: true }));
}
