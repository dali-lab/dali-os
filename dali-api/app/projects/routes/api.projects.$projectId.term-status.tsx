import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.term-status";
import { requireAuth } from "~/lib/auth";
import { requireProjectSettingsEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";

const Schema = z.object({
  termId: z.string().min(1),
  isContinuing: z.boolean(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectSettingsEditor(auth.user.sub, params.projectId!);

  if (request.method !== "POST" && request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return body;

  const row = await prisma.projectTermStatus.upsert({
    where: {
      projectId_termId: { projectId: params.projectId!, termId: body.termId },
    },
    create: {
      projectId: params.projectId!,
      termId: body.termId,
      isContinuing: body.isContinuing,
      setBy: auth.user.sub,
    },
    update: { isContinuing: body.isContinuing, setBy: auth.user.sub, setAt: new Date() },
  });
  return Response.json(row);
}
