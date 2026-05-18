import { redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/projects.new";
import { requireAuth } from "~/lib/auth";
import { requireProjectCreator } from "~/lib/projectAuth";
import { parseJson } from "~/lib/validate";
import { createProject } from "~/projects/lib/createProject";
import { logAuditEvent } from "~/lib/audit";

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  firstTermId: z.string().min(1),
  calendarEmail: z.string().email().nullable().optional(),
  initialPmUserIds: z.array(z.string()).default([]),
  partnerOrgIds: z.array(z.string()).default([]),
});

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectCreator(auth.user.sub);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, CreateProjectSchema);
  if (body instanceof Response) return body;

  const created = await createProject({
    name: body.name,
    firstTermId: body.firstTermId,
    calendarEmail: body.calendarEmail ?? null,
    initialPmUserIds: body.initialPmUserIds,
    partnerOrgIds: body.partnerOrgIds,
    creatorUserId: auth.user.sub,
  });

  await logAuditEvent({
    action: "role.change",
    userId: auth.user.sub,
    targetId: created.projectId,
    metadata: {
      kind: "project.created",
      name: body.name,
      pmIds: body.initialPmUserIds,
      partnerOrgIds: body.partnerOrgIds,
    },
    request,
  });

  return redirect(`/projects/${created.projectId}`);
}

export function loader() {
  return redirect("/projects");
}
