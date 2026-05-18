import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.archive";
import { requireAuth } from "~/lib/auth";
import { requireProjectArchiver } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";
import { emitEvent } from "~/lib/notifications";
import { logAuditEvent } from "~/lib/audit";

const Schema = z.object({
  status: z.enum(["Active", "Paused", "Archived"]),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectArchiver(auth.user.sub, params.projectId!);

  if (request.method !== "POST" && request.method !== "PATCH") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return body;

  const project = await prisma.project.update({
    where: { id: params.projectId! },
    data: { status: body.status },
  });

  // Notify all current-term assignments + partner users of material status
  // changes (archive/pause).
  if (body.status !== "Active") {
    const [assignments, partnerLinks] = await Promise.all([
      prisma.projectAssignment.findMany({
        where: { projectId: project.id },
        select: { userId: true },
      }),
      prisma.projectPartner.findMany({
        where: { projectId: project.id, endedAt: null },
        include: {
          partnerOrg: { include: { users: { select: { userId: true } } } },
        },
      }),
    ]);
    const recipients = new Set<string>();
    for (const a of assignments) recipients.add(a.userId);
    for (const link of partnerLinks) {
      for (const u of link.partnerOrg.users) recipients.add(u.userId);
    }
    recipients.delete(auth.user.sub);
    if (recipients.size > 0) {
      await emitEvent({
        type: body.status === "Archived" ? "project.archived" : "project.paused",
        recipients: [...recipients],
        payload: { projectId: project.id, name: project.name, status: body.status },
        inbox: {
          kind: "SystemAnnouncement",
          title: `Project ${body.status.toLowerCase()}: ${project.name}`,
          link: `/projects/${project.id}`,
          createdByUserId: auth.user.sub,
        },
      });
    }
  }

  await logAuditEvent({
    action: "role.change",
    userId: auth.user.sub,
    targetId: project.id,
    metadata: { kind: `project.status_change`, status: body.status, name: project.name },
    request,
  });

  return Response.json(project);
}
