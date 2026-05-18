import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.partners";
import { requireAuth } from "~/lib/auth";
import { requireProjectSettingsEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";

const LinkSchema = z.object({
  partnerOrgId: z.string().min(1),
});

const UnlinkSchema = z.object({
  projectPartnerId: z.string().min(1),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectSettingsEditor(auth.user.sub, params.projectId!);

  if (request.method === "POST") {
    const body = await parseJson(request, LinkSchema);
    if (body instanceof Response) return body;
    const row = await prisma.projectPartner.upsert({
      where: {
        projectId_partnerOrgId: {
          projectId: params.projectId!,
          partnerOrgId: body.partnerOrgId,
        },
      },
      create: {
        projectId: params.projectId!,
        partnerOrgId: body.partnerOrgId,
        startedAt: new Date(),
      },
      update: { endedAt: null, startedAt: new Date() },
    });
    return Response.json(row, { status: 201 });
  }

  if (request.method === "DELETE") {
    const body = await parseJson(request, UnlinkSchema);
    if (body instanceof Response) return body;
    await prisma.projectPartner.update({
      where: { id: body.projectPartnerId },
      data: { endedAt: new Date() },
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
